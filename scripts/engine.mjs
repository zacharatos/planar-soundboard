// Planar Soundboard — the audio engine.
// Music & ambience run through Playlist documents (synced to every client by Foundry, fades included).
// Pads & scatter sounds are one-shots broadcast with AudioHelper.play.
// Narrate (ducking) and Muffle are client-side effects driven over the module socket.

import { normFilterSpec, filterId, receiveFilters } from "./filters.mjs";
import { heaviness, describeHeavy } from "./audio-check.mjs";
import { t, info, warn, error } from "./i18n.mjs";
import {
  MODULE_ID, GLOBAL_ID, AudioHelperCls, channelOf, resolve, randomId, isActiveGM,
  getSetting, getState, setState, findScape, getScapes, activeScapes, getGlobalScape, scapePaths, oneShotPaths
} from "./store.mjs";

const SOCKET = `module.${MODULE_ID}`;
const DUCKABLE = new Set(["music", "environment"]);
const wait = ms => new Promise(r => setTimeout(r, ms));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = arr => arr[Math.floor(Math.random() * arr.length)];

/* ---------------------------------------- */
/*  Serial queue: activations never overlap */
/* ---------------------------------------- */

let chain = Promise.resolve();
function queue(fn) {
  chain = chain.catch(() => {}).then(fn);
  chain.catch(err => {
    console.error(`${MODULE_ID} |`, err);
    error("Notify.Error", { error: err.message ?? err });
  });
  return chain;
}

/* ---------------------------------------- */
/*  Helpers                                 */
/* ---------------------------------------- */

export function playingSounds() {
  const out = [];
  for (const pl of game.playlists) for (const s of pl.sounds) if (s.playing) out.push(s);
  return out;
}

function resolveFade(scape, fadeMs) {
  const v = fadeMs ?? scape?.fadeMs ?? getSetting("defaultFade");
  return Math.max(0, Math.round(Number(v) || 0));
}

/** What a set of scapes wants playing through Playlists. */
function collectTargets(scapes) {
  const tracks = new Map();     // sound uuid -> {doc, volume, channel, loop}
  const playlists = new Map();  // playlist id -> {doc, volume|null, channel}
  let keepMusic = false;
  for (const sc of scapes) {
    const m = sc.music;
    if (m.mode === "keep") keepMusic = true;
    else if (m.mode === "track") {
      const d = resolve(m.soundUuid);
      if (d) tracks.set(d.uuid, { doc: d, volume: m.volume, channel: m.channel || "music", loop: !!m.loop });
    } else if (m.mode === "playlist") {
      const p = resolve(m.playlistUuid);
      if (p) playlists.set(p.id, { doc: p, volume: m.overrideVolume ? m.volume : null, channel: m.channel || "music" });
    }
    for (const a of sc.ambience) {
      const d = resolve(a.soundUuid);
      if (d) tracks.set(d.uuid, { doc: d, volume: a.volume, channel: a.channel || "environment", loop: true });
    }
  }
  return { tracks, playlists, keepMusic };
}

const isTarget = (t, s) => t.tracks.has(s.uuid) || t.playlists.has(s.parent?.id);

/**
 * Apply a plan: stop some sounds, start/adjust others, start whole playlists.
 * Foundry performs the fades on every client: playing:true fades in, playing:false fades out.
 */
async function executePlan({ stops = [], starts = [], adjusts = [], playlistStarts = [], fade, transition }) {
  const groups = new Map();
  const group = pl => {
    if (!groups.has(pl.id)) groups.set(pl.id, { pl, stop: [], start: [] });
    return groups.get(pl.id);
  };
  for (const s of stops) group(s.parent).stop.push({ _id: s.id, playing: false, pausedTime: null, fade });
  for (const t of starts) {
    const upd = { _id: t.doc.id, playing: true, pausedTime: null, fade, volume: t.volume, repeat: t.loop };
    if (t.channel && t.doc.channel !== t.channel) upd.channel = t.channel;
    group(t.doc.parent).start.push(upd);
  }
  for (const a of adjusts) group(a.doc.parent).start.push({ _id: a.doc.id, volume: a.volume });

  const run = which => Promise.all([...groups.values()].map(({ pl, stop, start }) => {
    const sounds = which === "stop" ? stop : which === "start" ? start : [...stop, ...start];
    if (!sounds.length) return null;
    const byId = new Map(sounds.map(u => [u._id, u]));
    const willPlay = pl.sounds.some(s => {
      const u = byId.get(s.id);
      return u && "playing" in u ? u.playing : s.playing;
    });
    return pl.update({ playing: willPlay, sounds });
  }));

  const dip = transition === "dip" && fade > 0 && stops.length && (starts.length || playlistStarts.length);
  if (dip) {
    await run("stop");
    await wait(fade);
    await run("start");
  } else {
    await run("all");
  }
  for (const p of playlistStarts) await startPlaylist(p, fade);
}

/** Start a whole playlist (sequential / shuffle / simultaneous) with a fade-in. */
async function startPlaylist({ doc: pl, volume, channel }, fade) {
  const sounds = pl.sounds
    .filter(s => s.fade !== fade || (volume != null && s.volume !== volume))
    .map(s => ({ _id: s.id, fade, ...(volume != null ? { volume } : {}) }));
  const upd = { fade };
  if (channel && pl.channel !== channel) upd.channel = channel;
  if (sounds.length) upd.sounds = sounds;
  await pl.update(upd);
  if (pl.mode === CONST.PLAYLIST_MODES.DISABLED) {
    // "Soundboard only" playlists won't playAll — start the first track instead.
    const first = pl.sounds.contents[0];
    if (first) await pl.update({ playing: true, sounds: [{ _id: first.id, playing: true, pausedTime: null }] });
    return;
  }
  await pl.playAll();
}

/** Build stops/starts/adjusts so that exactly `targets` (plus kept things) are playing. */
function planFor(targets, { stopCandidates }) {
  const playing = playingSounds();
  const starts = [], adjusts = [], playlistStarts = [];
  for (const t of targets.tracks.values()) {
    if (t.doc.playing) {
      if (Math.abs((t.doc.volume ?? 0) - t.volume) > 0.005) adjusts.push(t);
    } else starts.push(t);
  }
  for (const p of targets.playlists.values()) {
    const anyPlaying = p.doc.sounds.some(s => s.playing);
    if (!anyPlaying) playlistStarts.push(p);
    else if (p.volume != null) {
      for (const s of p.doc.sounds) if (s.playing && Math.abs(s.volume - p.volume) > 0.005) adjusts.push({ doc: s, volume: p.volume });
    }
  }
  const stops = playing.filter(s => !isTarget(targets, s) && stopCandidates(s));
  return { starts, adjusts, playlistStarts, stops };
}

/* ---------------------------------------- */
/*  Public engine API                       */
/* ---------------------------------------- */

/**
 * Activate a soundscape.
 * @param {string} idOrName
 * @param {object} [opts]
 * @param {boolean} [opts.additive]  Layer it on top (toggle) instead of replacing.
 * @param {number}  [opts.fadeMs]    Override the fade for this switch.
 */
export function activate(idOrName, opts = {}) {
  return queue(() => _activate(idOrName, opts));
}

async function _activate(idOrName, { additive = false, fadeMs = null, keepCombatReturn = false } = {}) {
  const scape = findScape(idOrName);
  if (!scape) return warn("Notify.NoScape", { name: idOrName });
  if (scape.isGlobal) return;
  const st = getState();
  const fade = resolveFade(scape, fadeMs);

  if (additive) {
    if (st.base === scape.id) return;
    if (st.overlays.includes(scape.id)) return _deactivateOverlay(scape.id, { fadeMs });
    const targets = collectTargets([scape]);
    // An overlay never stops anything; it only adds its own layers.
    await executePlan({ ...planFor(targets, { stopCandidates: () => false }), fade, transition: "crossfade" });
    st.overlays.push(scape.id);
    await setState(st);
    syncScapeFilters(fade);
    startScatter(scape);
    preloadOneShotsSoon([scape]);
    Hooks.callAll(`${MODULE_ID}.activate`, scape, { additive: true });
    return;
  }

  // Full switch: new base + sticky overlays survive, everything else goes.
  const sticky = st.overlays.map(findScape).filter(s => s?.sticky && s.id !== scape.id);
  const keep = [scape, ...sticky];
  const targets = collectTargets(keep);
  const previous = collectTargets(activeScapes(st));
  const takeOver = getSetting("stopUnmanaged");

  const stopCandidates = s => {
    const ch = channelOf(s);
    if (targets.keepMusic && ch === "music") return false;
    if (isTarget(previous, s)) return true;                 // belonged to the old scape
    return takeOver && DUCKABLE.has(ch);                    // started by hand: music/ambient only
  };

  await executePlan({ ...planFor(targets, { stopCandidates }), fade, transition: scape.transition });

  const newState = { base: scape.id, overlays: sticky.map(s => s.id), combatReturn: keepCombatReturn ? st.combatReturn : null };
  await setState(newState);
  syncScapeFilters(fade);
  for (const old of activeScapes(st)) if (!keep.some(k => k.id === old.id)) stopScatter(old.id);
  for (const k of keep) startScatter(k);
  preloadOneShotsSoon(keep);
  Hooks.callAll(`${MODULE_ID}.activate`, scape, { additive: false });
}

export function deactivateOverlay(id, opts = {}) {
  return queue(() => _deactivateOverlay(id, opts));
}

async function _deactivateOverlay(id, { fadeMs = null } = {}) {
  const st = getState();
  const scape = findScape(id);
  if (!scape || !st.overlays.includes(scape.id)) return;
  const rest = activeScapes({ ...st, overlays: st.overlays.filter(o => o !== scape.id) });
  const mine = collectTargets([scape]);
  const others = collectTargets(rest);
  const stops = playingSounds().filter(s => isTarget(mine, s) && !isTarget(others, s));
  await executePlan({ stops, fade: resolveFade(scape, fadeMs), transition: "crossfade" });
  st.overlays = st.overlays.filter(o => o !== scape.id);
  await setState(st);
  syncScapeFilters(resolveFade(scape, fadeMs));
  stopScatter(scape.id);
}

/** Fade out all music and ambience and clear the active soundscapes. */
export function stopAll({ fadeMs = null } = {}) {
  return queue(async () => {
    const fade = resolveFade(null, fadeMs);
    const current = collectTargets(activeScapes());
    const stops = playingSounds().filter(s => DUCKABLE.has(channelOf(s)) || isTarget(current, s));
    stopScatter();
    for (const src of activeLoopPads.values()) stopSrc(src, fade);
    activeLoopPads.clear();
    for (const id of padDuckIds.values()) setDuck(id, null, fade);
    padDuckIds.clear();
    await executePlan({ stops, fade, transition: "crossfade" });
    await setState({ base: null, overlays: [], combatReturn: null });
    syncScapeFilters(fade);
  });
}

/** Set the live volume of one playing PlaylistSound (synced). */
export async function setTrackVolume(sound, volume) {
  if (!sound) return;
  if (typeof sound.debounceVolume === "function") sound.debounceVolume(volume);
  else await sound.update({ volume });
}

export async function stopTrack(sound, fadeMs = null) {
  if (!sound) return;
  await executePlan({ stops: [sound], fade: resolveFade(null, fadeMs), transition: "crossfade" });
}

/* ---------------------------------------- */
/*  One-shots: pads & scatter               */
/* ---------------------------------------- */

/** Play a file for everyone (or only locally) on a given channel. */
export async function playOneShot(src, { volume = 0.8, channel = "interface", loop = false, broadcast = true } = {}) {
  if (!src) return null;
  try {
    return await AudioHelperCls().play({ src, volume, channel, loop, autoplay: true }, broadcast);
  } catch (err) {
    console.error(`${MODULE_ID} | could not play ${src}`, err);
    return null;
  }
}

const activeLoopPads = new Map(); // pad id -> src (GM side)
const padDuckIds = new Map();     // looping pad id -> duck id
export const isLoopPadActive = id => activeLoopPads.has(id);

export async function playPad(pad) {
  if (!pad?.sources?.length) return warn("Notify.PadEmpty", { name: pad?.name ?? "?" });
  if (pad.loop && activeLoopPads.has(pad.id)) return stopPad(pad);
  const src = pick(pad.sources);
  const sound = await playOneShot(src, { volume: pad.volume, channel: pad.channel, loop: pad.loop });
  if (pad.loop) {
    activeLoopPads.set(pad.id, src);
    Hooks.callAll(`${MODULE_ID}.padsChanged`);
  }
  if (pad.duck) {
    const id = `pad-${randomId()}`;
    setDuck(id, getSetting("padDuckLevel"), 250);
    if (!pad.loop) {
      const dur = Number(sound?.duration);
      const ms = Number.isFinite(dur) && dur > 0 ? dur * 1000 : 3000;
      setTimeout(() => setDuck(id, null, 1200), Math.max(500, ms - 400));
    } else padDuckIds.set(pad.id, id);
  }
}

/** Stop every pad sound using these sources, on every client. */
export function stopPad(pad) {
  for (const src of pad.sources) stopSrc(src, 600);
  activeLoopPads.delete(pad.id);
  const duckId = padDuckIds.get(pad.id);
  if (duckId) { setDuck(duckId, null, 1000); padDuckIds.delete(pad.id); }
  Hooks.callAll(`${MODULE_ID}.padsChanged`);
}

/** First nine pads across the active scapes, then global pads: bound to Alt+1…9. */
export function hotkeyPads() {
  const list = [];
  for (const sc of [...activeScapes(), getGlobalScape()].filter(Boolean)) {
    for (const pad of sc.pads) list.push({ scape: sc, pad });
  }
  return list.slice(0, 9);
}

/* ---- scatter ---- */

const scatterTimers = new Map(); // "scapeId:layerId" -> timeout

export function startScatter(scape) {
  if (!isActiveGM() || !scape) return;
  for (const layer of scape.scatter) {
    if (!layer.sources.length) continue;
    const key = `${scape.id}:${layer.id}`;
    if (scatterTimers.has(key)) continue;
    const lo = Math.min(layer.minDelay, layer.maxDelay), hi = Math.max(layer.minDelay, layer.maxDelay);
    const schedule = () => {
      const t = setTimeout(async () => {
        if (!scatterTimers.has(key)) return;
        await playOneShot(pick(layer.sources), {
          volume: rand(Math.min(layer.volMin, layer.volMax), Math.max(layer.volMin, layer.volMax)),
          channel: layer.channel
        });
        if (scatterTimers.has(key)) schedule();
      }, rand(lo, hi) * 1000);
      scatterTimers.set(key, t);
    };
    schedule();
  }
}

export function stopScatter(scapeId = null) {
  for (const [key, t] of scatterTimers) {
    if (scapeId && !key.startsWith(`${scapeId}:`)) continue;
    clearTimeout(t);
    scatterTimers.delete(key);
  }
}

/** After a GM reload: resume scatter for whatever is still active. */
export function resumeScatter() {
  for (const sc of activeScapes()) startScatter(sc);
}

/* ---------------------------------------- */
/*  Preload                                 */
/* ---------------------------------------- */

// Preload goes over the module socket: each client loads the files itself, one at a time, and
// skips files it already has. One file at a time keeps the server's upload from being swamped.

const preloaded = new Set();   // paths this client has loaded (or is loading)
let preloadChain = Promise.resolve();

function preloadLocal(paths) {
  const fresh = paths.filter(p => !preloaded.has(p));
  for (const p of fresh) preloaded.add(p);
  if (!fresh.length) return preloadChain;
  preloadChain = preloadChain.then(async () => {
    for (const p of fresh) {
      try { await AudioHelperCls().preloadSound(p); }
      catch (err) { preloaded.delete(p); console.warn(`${MODULE_ID} | preload failed`, p, err); }
    }
  });
  return preloadChain;
}

/**
 * Ask clients to preload audio files.
 * @param {string[]} paths
 * @param {object} [opts]
 * @param {string[]|null} [opts.to]  user ids; null = everyone (this client included)
 * @returns {number} how many distinct files were asked for
 */
export function preloadPaths(paths, { to = null } = {}) {
  const list = [...new Set((paths ?? []).filter(Boolean))];
  if (!list.length || !game.user?.isGM) return 0;
  game.socket.emit(SOCKET, { action: "preload", from: game.user.id, paths: list, to });
  if (!to || to.includes(game.user.id)) preloadLocal(list);
  return list.length;
}

/** The Preload button: everything the scape can play, on every client, plus a heavy-file check. */
export async function preloadScape(scape) {
  const paths = scapePaths(scape);
  preloadPaths(paths);
  info("Notify.Preloading", { n: paths.length, name: scape.name });
  const heavy = await findHeavy(paths);
  if (heavy.length) warn("Notify.HeavyFiles", { name: scape.name, n: heavy.length, files: heavy.slice(0, 3).map(describeHeavy).join(", ") });
}

/** Files that are uncompressed or bigger than the limit (asks the server for sizes, GM side). */
export async function findHeavy(paths) {
  const out = [];
  for (const path of paths) {
    let bytes = null;
    if (!heaviness(path)) {
      try {
        const res = await fetch(path, { method: "HEAD" });
        const len = Number(res.headers?.get?.("content-length"));
        if (res.ok && Number.isFinite(len) && len > 0) bytes = len;
      } catch { /* size unknown: not flagged */ }
    }
    if (heaviness(path, bytes)) out.push({ path, bytes });
  }
  return out;
}

/** After a switch: pads and scatter of these scapes, once the switch itself has had its bandwidth. */
const PRELOAD_DELAY_MS = 5000;
function preloadOneShotsSoon(scapes) {
  if (!isActiveGM()) return;
  const paths = scapes.flatMap(oneShotPaths);
  if (paths.length) setTimeout(() => preloadPaths(paths), PRELOAD_DELAY_MS);
}

/**
 * A player just connected: the pads and scatter of what's active plus the global pads, for that
 * player only. (Music and ambience already playing reach them through Foundry's playlists.)
 */
export function preloadForUser(userId) {
  if (!isActiveGM() || !userId) return 0;
  const scapes = [...activeScapes(), getGlobalScape()].filter(Boolean);
  return preloadPaths(scapes.flatMap(oneShotPaths), { to: [userId] });
}

/* ---------------------------------------- */
/*  FX: narrate (ducking) & Planar Filters  */
/* ---------------------------------------- */

// GM-authored FX state, broadcast whole so late joiners can be resynced.
const fx = { ducks: {}, filters: {} };
const filterTimers = new Map(); // filter id -> auto-off timeout (GM side)
// Ducks this client is currently applying.
const local = { ducks: {}, ticker: null };

export const fxState = () => ({
  narrate: "narrate" in fx.ducks,
  muffle: "muffle" in fx.filters,
  filters: Object.values(fx.filters).map(f => ({ ...f }))
});

function emitFx(fadeMs) {
  const msg = { action: "fx", ducks: { ...fx.ducks }, filters: foundry.utils.deepClone(fx.filters), fadeMs };
  game.socket.emit(SOCKET, msg);
  applyFxMessage(msg);
  Hooks.callAll(`${MODULE_ID}.fxChanged`, fxState());
}

export function setDuck(id, factor, fadeMs = 800) {
  if (factor == null) delete fx.ducks[id];
  else fx.ducks[id] = factor;
  emitFx(fadeMs);
}

export function narrate(on) {
  const next = on ?? !("narrate" in fx.ducks);
  setDuck("narrate", next ? getSetting("narrateLevel") : null, next ? 900 : 1500);
  return next;
}

/**
 * Turn a Planar Filter on.
 * @param {string} presetId   muffled, underwater, cavern, vastHall, ethereal, memory, deafened, sending
 * @param {object} [opts]     {targets: [userId], intensity, hold (ms, auto-off), channels, fadeIn, fadeOut, id}
 * @returns {string} the filter's id
 */
export function setFilter(presetId, opts = {}) {
  const spec = normFilterSpec(presetId, {
    ...opts,
    targets: resolveUsers(opts.targets),
    cutoff: presetId === "muffled" ? (opts.cutoff ?? getSetting("muffleCutoff")) : opts.cutoff
  });
  fx.filters[spec.id] = spec;
  clearTimeout(filterTimers.get(spec.id));
  filterTimers.delete(spec.id);
  if (spec.hold) filterTimers.set(spec.id, setTimeout(() => clearFilter(spec.id), spec.hold));
  emitFx(spec.fadeIn);
  return spec.id;
}

export function clearFilter(id) {
  if (!(id in fx.filters)) return;
  clearTimeout(filterTimers.get(id));
  filterTimers.delete(id);
  delete fx.filters[id];
  emitFx(0);
}

/** Turn a preset off: for these targets, or (no targets given) every instance of it. */
export function clearPreset(presetId, targets = null) {
  const users = targets == null ? null : resolveUsers(targets);
  const ids = Object.values(fx.filters).filter(f => f.preset === presetId &&
    (users == null || f.id === filterId(presetId, users))).map(f => f.id);
  for (const id of ids) {
    clearTimeout(filterTimers.get(id));
    filterTimers.delete(id);
    delete fx.filters[id];
  }
  if (ids.length) emitFx(0);
}

export function clearAllFilters() {
  for (const t of filterTimers.values()) clearTimeout(t);
  filterTimers.clear();
  fx.filters = {};
  emitFx(0);
}

/** Toggle a preset for a set of targets (none = everyone). Returns true if now on. */
export function toggleFilter(presetId, opts = {}) {
  const id = filterId(presetId, resolveUsers(opts.targets));
  if (id in fx.filters) { clearFilter(id); return false; }
  setFilter(presetId, opts);
  return true;
}

export function isFilterOn(presetId, targets = []) {
  return filterId(presetId, resolveUsers(targets)) in fx.filters;
}

/** Accept user ids, user names or character names. */
function resolveUsers(list) {
  if (!list) return [];
  const arr = Array.isArray(list) ? list : [list];
  return [...new Set(arr.map(x => {
    if (!x) return null;
    if (typeof x === "object") return x.id ?? null;
    const key = String(x).toLowerCase();
    const u = game.users.get(x) ?? game.users.find(u => u.name.toLowerCase() === key || u.character?.name?.toLowerCase() === key);
    return u?.id ?? null;
  }).filter(Boolean))].sort();
}

export function muffle(on) {
  const next = on ?? !("muffle" in fx.filters);
  if (next) setFilter("muffled", { id: "muffle" });
  else clearFilter("muffle");
  return next;
}

/** Filters carried by the active soundscapes ("scape:<id>"). */
export function syncScapeFilters(fadeMs = null) {
  const wanted = new Map(activeScapes().filter(s => s.filter?.preset).map(s => [`scape:${s.id}`, s]));
  let changed = false;
  for (const id of Object.keys(fx.filters)) {
    if (id.startsWith("scape:") && !wanted.has(id)) { delete fx.filters[id]; changed = true; }
  }
  for (const [id, sc] of wanted) {
    const cur = fx.filters[id];
    if (cur && cur.preset === sc.filter.preset && cur.intensity === sc.filter.intensity) continue;
    fx.filters[id] = normFilterSpec(sc.filter.preset, {
      id, intensity: sc.filter.intensity, hold: null,
      ...(fadeMs != null ? { fadeIn: fadeMs, fadeOut: fadeMs } : {}),
      cutoff: sc.filter.preset === "muffled" ? getSetting("muffleCutoff") : null
    });
    changed = true;
  }
  if (changed) emitFx(fadeMs ?? 1000);
}

export function resyncFx() {
  if (Object.keys(fx.ducks).length || Object.keys(fx.filters).length) emitFx(0);
}

export function stopSrc(src, fadeMs = 600) {
  const msg = { action: "stopSrc", src, fadeMs };
  game.socket.emit(SOCKET, msg);
  handleSocket(msg);
}

/* ---- client side ---- */

export function registerSocket() {
  game.socket.on(SOCKET, handleSocket);
}

function handleSocket(msg) {
  if (!msg?.action) return;
  if (msg.action === "fx") return applyFxMessage(msg);
  if (msg.action === "stopSrc") return stopLocalSrc(msg.src, msg.fadeMs);
  if (msg.action === "preload") {
    if (!game.users.get(msg.from)?.isGM) return;
    if (msg.to && !msg.to.includes(game.user.id)) return;
    if (Array.isArray(msg.paths)) preloadLocal(msg.paths.filter(p => typeof p === "string"));
  }
}

function sameSrc(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  try { a = decodeURIComponent(a); b = decodeURIComponent(b); } catch { /* ignore */ }
  return a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`);
}

function stopLocalSrc(src, fadeMs) {
  const playing = game.audio?.playing;
  if (!playing) return;
  for (const sound of playing.values()) {
    if (!sameSrc(sound.src, src)) continue;
    // Don't touch PlaylistSounds — those are stopped through their documents.
    if (isPlaylistSoundObject(sound)) continue;
    try { sound.stop({ fade: fadeMs, volume: 0 }); } catch { sound.stop?.(); }
  }
}

function isPlaylistSoundObject(sound) {
  for (const s of playingSounds()) if (s.sound === sound) return true;
  return false;
}

function applyFxMessage(msg) {
  local.ducks = msg.ducks ?? {};
  const fade = msg.fadeMs ?? 800;
  applyDuck(fade, true);
  receiveFilters(msg.filters ?? {});
  const active = Object.keys(local.ducks).length;
  if (active && !local.ticker) local.ticker = setInterval(() => applyDuck(500, false), 1000);
  if (!active && local.ticker) { clearInterval(local.ticker); local.ticker = null; }
}

function duckablePlaying() {
  return playingSounds().filter(ps => DUCKABLE.has(channelOf(ps)) && ps.sound?.playing);
}

// How often the 1 s check may correct a sound whose volume drifted away from our duck (something
// else faded it, e.g. Foundry's own fade-in) before giving up on that sound.
const MAX_DUCK_FIXES = 3;

function applyDuck(fadeMs, force) {
  const factors = Object.values(local.ducks);
  const factor = factors.length ? Math.min(...factors) : 1;
  const now = Date.now();
  for (const ps of duckablePlaying()) {
    const snd = ps.sound;
    const base = ps.volume ?? 0.5;
    if (factor === 1) {
      if (snd._psDuck) { snd.fade(base, { duration: fadeMs }); delete snd._psDuck; }
      continue;
    }
    const target = base * factor;
    const d = snd._psDuck;
    let fade = force || !d || Math.abs(d.target - target) > 0.001;
    if (!fade && now > d.until && d.fixes < MAX_DUCK_FIXES) {
      // Our own fade has finished: only step in if the volume really is somewhere else.
      const current = Number(snd.volume);
      if (Number.isFinite(current) && Math.abs(current - target) > 0.02) { fade = true; d.fixes++; }
    }
    if (!fade) continue;
    snd._psDuck = { target, until: now + fadeMs + 250, fixes: d && Math.abs(d.target - target) <= 0.001 ? d.fixes : 0 };
    snd.fade(target, { duration: fadeMs });
  }
}

/* ---------------------------------------- */
/*  Automation: scenes & combat             */
/* ---------------------------------------- */

export function onSceneActivated(scene) {
  if (!isActiveGM() || !getSetting("sceneAutoplay")) return;
  const scape = findScapeForScene(scene.id);
  if (scape && getState().base !== scape.id) activate(scape.id);
}

function findScapeForScene(sceneId) {
  return getScapes().find(s => s.sceneId === sceneId) ?? null;
}

export function onCombatStart() {
  if (!isActiveGM() || !getSetting("combatAuto")) return;
  queue(async () => {
    const st = getState();
    const current = findScape(st.base);
    const combatId = current?.combatScapeId || getSetting("combatScape");
    const combat = findScape(combatId);
    if (!combat || combat.id === st.base) return;
    await setState({ ...st, combatReturn: { base: st.base, overlays: st.overlays } });
    await _activate(combat.id, { keepCombatReturn: true });
  });
}

export function onCombatEnd() {
  if (!isActiveGM() || !getSetting("combatAuto")) return;
  queue(async () => {
    const st = getState();
    const ret = st.combatReturn;
    if (!ret) return;
    if (game.combats?.some(c => c.started)) return; // another fight is still running
    if (ret.base && findScape(ret.base)) {
      await _activate(ret.base);
      for (const o of ret.overlays ?? []) {
        if (!getState().overlays.includes(o)) await _activate(o, { additive: true });
      }
    } else {
      await setState({ ...st, combatReturn: null });
    }
  });
}
