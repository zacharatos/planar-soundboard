// Planar Soundboard — data layer: soundscape definitions, settings, lookups.

import { key, t, info, warn, error } from "./i18n.mjs";

export const MODULE_ID = "planar-soundboard";
export const GLOBAL_ID = "__global__";

/** The three Foundry audio channels; labels come from lang (Channels.<id>). */
export const CHANNELS = {
  music: { icon: "fa-solid fa-music" },
  environment: { icon: "fa-solid fa-wind" },
  interface: { icon: "fa-solid fa-bell" }
};
export const channelLabel = id => (id in CHANNELS ? t(`Channels.${id}`) : id);

/* ---------------------------------------- */
/*  Foundry helpers                         */
/* ---------------------------------------- */

export const AudioHelperCls = () => foundry.audio?.AudioHelper ?? globalThis.AudioHelper;
export const FilePickerCls = () =>
  foundry.applications?.apps?.FilePicker?.implementation ?? globalThis.FilePicker;
export const saveFile = (...args) =>
  (foundry.utils.saveDataToFile ?? globalThis.saveDataToFile)(...args);

export const randomId = () => foundry.utils.randomID();
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, c =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

export function soundName(path) {
  if (!path) return "";
  try { return AudioHelperCls().getDefaultSoundName(path); }
  catch { return decodeURIComponent(path.split("/").pop().replace(/\.[^.]+$/, "")); }
}

/** Resolve a world document by UUID without throwing. */
export function resolve(uuid) {
  if (!uuid) return null;
  try { return fromUuidSync(uuid) ?? null; } catch { return null; }
}

/** The channel a PlaylistSound actually plays on. */
export function channelOf(sound) {
  return sound?.channel || sound?.parent?.channel || "music";
}

/** Is this client the GM that should run automation (scatter timers, hooks)? */
export function isActiveGM() {
  if (!game.user?.isGM) return false;
  const active = game.users?.activeGM;
  return active ? active.isSelf ?? (active.id === game.user.id) : true;
}

/* ---------------------------------------- */
/*  Defaults & normalisation                */
/* ---------------------------------------- */

const num = (v, d) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? d : Number(v));

export function normAmbience(a = {}) {
  return {
    id: a.id || randomId(),
    soundUuid: a.soundUuid || "",
    volume: clamp(num(a.volume, 0.5), 0, 1),
    channel: a.channel || "environment"
  };
}

export function normScatter(s = {}) {
  return {
    id: s.id || randomId(),
    name: s.name || t("Defaults.Scatter"),
    sources: Array.isArray(s.sources) ? s.sources.filter(Boolean) : [],
    minDelay: Math.max(1, num(s.minDelay, 20)),
    maxDelay: Math.max(1, num(s.maxDelay, 60)),
    volMin: clamp(num(s.volMin, 0.3), 0, 1),
    volMax: clamp(num(s.volMax, 0.6), 0, 1),
    channel: s.channel || "environment"
  };
}

export function normPad(p = {}) {
  return {
    id: p.id || randomId(),
    name: p.name || t("Defaults.Pad"),
    icon: p.icon || "fa-solid fa-bolt",
    color: p.color || "",
    sources: Array.isArray(p.sources) ? p.sources.filter(Boolean) : [],
    volume: clamp(num(p.volume, 0.8), 0, 1),
    channel: p.channel || "interface",
    duck: !!p.duck,
    loop: !!p.loop
  };
}

export function normScape(s = {}) {
  const m = s.music ?? {};
  return {
    id: s.id || randomId(),
    name: s.name || t("Defaults.Scape"),
    group: s.group || "",
    icon: s.icon || "fa-solid fa-music",
    color: s.color || "#6d5a9c",
    img: s.img || "",
    notes: s.notes || "",
    sceneId: s.sceneId || "",
    fadeMs: s.fadeMs === null || s.fadeMs === undefined || s.fadeMs === "" ? null : Math.max(0, Number(s.fadeMs)),
    transition: s.transition === "dip" ? "dip" : "crossfade",
    combatScapeId: s.combatScapeId || "",
    sticky: !!s.sticky,
    isGlobal: !!s.isGlobal,
    sort: num(s.sort, 0),
    filter: { preset: s.filter?.preset || "", intensity: clamp(num(s.filter?.intensity, 1), 0, 1) },
    music: {
      mode: ["none", "keep", "playlist", "track"].includes(m.mode) ? m.mode : "none",
      playlistUuid: m.playlistUuid || "",
      soundUuid: m.soundUuid || "",
      volume: clamp(num(m.volume, 0.5), 0, 1),
      overrideVolume: !!m.overrideVolume,
      loop: m.loop ?? true,
      channel: m.channel || "music"
    },
    ambience: (s.ambience ?? []).map(normAmbience),
    scatter: (s.scatter ?? []).map(normScatter),
    pads: (s.pads ?? []).map(normPad)
  };
}

/* ---------------------------------------- */
/*  Settings                                */
/* ---------------------------------------- */

export function registerSettings(onChange) {
  const reg = (key, data) => game.settings.register(MODULE_ID, key, data);
  reg("soundscapes", { scope: "world", config: false, type: Array, default: [], onChange });
  reg("state", { scope: "world", config: false, type: Object,
    default: { base: null, overlays: [], combatReturn: null }, onChange });
  reg("combatScape", { scope: "world", config: false, type: String, default: "", onChange });
  reg("cueLists", { scope: "world", config: false, type: Array, default: [], onChange });
  reg("cueRun", { scope: "world", config: false, type: Object, default: { listId: null, index: 0, last: null }, onChange });

  reg("defaultFade", {
    name: key("Settings.defaultFade.Name"),
    hint: key("Settings.defaultFade.Hint"),
    scope: "world", config: true, type: Number, default: 3000,
    range: { min: 0, max: 20000, step: 250 }
  });
  reg("stopUnmanaged", {
    name: key("Settings.stopUnmanaged.Name"),
    hint: key("Settings.stopUnmanaged.Hint"),
    scope: "world", config: true, type: Boolean, default: true
  });
  reg("narrateLevel", {
    name: key("Settings.narrateLevel.Name"),
    hint: key("Settings.narrateLevel.Hint"),
    scope: "world", config: true, type: Number, default: 0.3,
    range: { min: 0, max: 1, step: 0.05 }
  });
  reg("padDuckLevel", {
    name: key("Settings.padDuckLevel.Name"),
    hint: key("Settings.padDuckLevel.Hint"),
    scope: "world", config: true, type: Number, default: 0.35,
    range: { min: 0, max: 1, step: 0.05 }
  });
  reg("muffleCutoff", {
    name: key("Settings.muffleCutoff.Name"),
    hint: key("Settings.muffleCutoff.Hint"),
    scope: "world", config: true, type: Number, default: 700,
    range: { min: 150, max: 4000, step: 50 }
  });
  reg("uploadFolder", {
    name: key("Settings.uploadFolder.Name"),
    hint: key("Settings.uploadFolder.Hint"),
    scope: "world", config: true, type: String, default: "soundboard-uploads"
  });
  reg("sceneAutoplay", {
    name: key("Settings.sceneAutoplay.Name"),
    hint: key("Settings.sceneAutoplay.Hint"),
    scope: "world", config: true, type: Boolean, default: true
  });
  reg("combatAuto", {
    name: key("Settings.combatAuto.Name"),
    hint: key("Settings.combatAuto.Hint"),
    scope: "world", config: true, type: Boolean, default: true
  });
}

export const getSetting = key => game.settings.get(MODULE_ID, key);
export const setSetting = (key, value) => game.settings.set(MODULE_ID, key, value);

/* ---------------------------------------- */
/*  Soundscape CRUD                         */
/* ---------------------------------------- */

export function getAllScapes() {
  const raw = foundry.utils.deepClone(getSetting("soundscapes") ?? []);
  return raw.map(normScape);
}

/** Soundscapes shown as cards (the global pad bank is excluded). */
export function getScapes() {
  return getAllScapes().filter(s => !s.isGlobal).sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
}

export function getGlobalScape() {
  return getAllScapes().find(s => s.isGlobal) ?? null;
}

export async function saveAllScapes(list) {
  return setSetting("soundscapes", list.map(normScape));
}

export async function upsertScape(scape) {
  const list = getAllScapes();
  const i = list.findIndex(s => s.id === scape.id);
  if (i >= 0) list[i] = normScape(scape);
  else list.push(normScape({ ...scape, sort: Math.max(0, ...list.map(s => s.sort)) + 1 }));
  return saveAllScapes(list);
}

export async function deleteScape(id) {
  return saveAllScapes(getAllScapes().filter(s => s.id !== id));
}

export async function ensureGlobalScape() {
  if (getGlobalScape()) return;
  await upsertScape(normScape({ id: GLOBAL_ID, name: t("Defaults.GlobalPads"), isGlobal: true, icon: "fa-solid fa-star" }));
}

export function findScape(idOrName) {
  if (!idOrName) return null;
  const all = getAllScapes();
  if (typeof idOrName === "object") return all.find(s => s.id === idOrName.id) ?? null;
  const key = String(idOrName).toLowerCase();
  return all.find(s => s.id === idOrName) ?? all.find(s => s.name.toLowerCase() === key) ?? null;
}

export function getState() {
  const st = foundry.utils.deepClone(getSetting("state") ?? {});
  return { base: st.base ?? null, overlays: Array.isArray(st.overlays) ? st.overlays : [], combatReturn: st.combatReturn ?? null };
}

export async function setState(st) {
  return setSetting("state", { base: st.base ?? null, overlays: [...new Set(st.overlays ?? [])], combatReturn: st.combatReturn ?? null });
}

/** The scapes currently active (base first, then overlays), resolved. */
export function activeScapes(st = getState()) {
  return [st.base, ...st.overlays].map(id => findScape(id)).filter(Boolean);
}

/** Number of layer references that no longer resolve (deleted playlists/sounds). */
export function missingCount(scape) {
  let n = 0;
  if (scape.music.mode === "track" && !resolve(scape.music.soundUuid)) n++;
  if (scape.music.mode === "playlist" && !resolve(scape.music.playlistUuid)) n++;
  for (const a of scape.ambience) if (!resolve(a.soundUuid)) n++;
  return n;
}

/** Every audio path a scape could play — used for preloading. */
export function scapePaths(scape) {
  const paths = new Set();
  const add = p => p && paths.add(p);
  if (scape.music.mode === "track") add(resolve(scape.music.soundUuid)?.path);
  if (scape.music.mode === "playlist") {
    const pl = resolve(scape.music.playlistUuid);
    const firstId = pl?.playbackOrder?.[0];
    add((firstId && pl.sounds.get(firstId)?.path) || pl?.sounds?.contents?.[0]?.path);
  }
  for (const a of scape.ambience) add(resolve(a.soundUuid)?.path);
  for (const l of [...scape.pads, ...scape.scatter]) l.sources.forEach(add);
  return [...paths];
}

/**
 * Find or create a PlaylistSound for a raw file path, in a library playlist owned by the module.
 * Lets you pick files directly for music/ambience while still syncing through Playlists.
 */
export async function ensureLibrarySound(path) {
  const Playlist = CONFIG.Playlist.documentClass;
  let pl = game.playlists.find(p => p.getFlag(MODULE_ID, "library"));
  if (!pl) {
    pl = await Playlist.create({
      name: t("Defaults.Library"),
      mode: CONST.PLAYLIST_MODES.SIMULTANEOUS,
      flags: { [MODULE_ID]: { library: true } }
    });
  }
  let sound = pl.sounds.find(s => s.path === path);
  if (!sound) {
    [sound] = await pl.createEmbeddedDocuments("PlaylistSound", [{ name: soundName(path), path, repeat: true, volume: 0.5 }]);
  }
  return sound;
}

/** Turn drag data from the sidebar into documents. */
export function docFromDrop(event) {
  let data;
  try { data = JSON.parse(event.dataTransfer.getData("text/plain")); } catch { return null; }
  if (!data?.type) return null;
  let doc = data.uuid ? resolve(data.uuid) : null;
  if (!doc && data.type === "Playlist" && data.id) doc = game.playlists.get(data.id);
  if (!doc && data.type === "PlaylistSound" && data.playlistId) doc = game.playlists.get(data.playlistId)?.sounds.get(data.soundId ?? data.id);
  if (!doc || !["Playlist", "PlaylistSound"].includes(doc.documentName)) return null;
  return doc;
}

/* ---------------------------------------- */
/*  Uploading files from the GM's computer  */
/* ---------------------------------------- */

const AUDIO_EXT = /\.(mp3|ogg|oga|opus|wav|flac|webm|m4a|aac)$/i;

export function isAudioFile(file) {
  return !!file && (file.type?.startsWith("audio/") || AUDIO_EXT.test(file.name ?? ""));
}

export function slugify(str) {
  return String(str ?? "").normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9Ͱ-Ͽ]+/g, "-").replace(/^-+|-+$/g, "") || "misc";
}

async function ensureDir(FP, source, path) {
  const parts = path.split("/").filter(Boolean);
  let cur = "";
  for (const part of parts) {
    cur = cur ? `${cur}/${part}` : part;
    try { await FP.createDirectory(source, cur, {}); } catch { /* already exists */ }
  }
}

/**
 * Upload audio files dropped from the desktop to the Foundry server.
 * @param {FileList|File[]} files
 * @param {string} [subfolder]   e.g. a soundscape name
 * @returns {Promise<string[]>}  server paths of the uploaded files
 */
export async function uploadAudioFiles(files, subfolder = "") {
  const list = [...(files ?? [])];
  const audio = list.filter(isAudioFile);
  if (list.length && !audio.length) {
    warn("Notify.NotAudio");
    return [];
  }
  if (!game.user.can?.("FILES_UPLOAD")) {
    error("Notify.NoUpload");
    return [];
  }
  const FP = FilePickerCls();
  const source = "data";
  const root = (getSetting("uploadFolder") || "soundboard-uploads").replace(/^\/+|\/+$/g, "");
  const target = subfolder ? `${root}/${slugify(subfolder)}` : root;
  await ensureDir(FP, source, target);
  const paths = [];
  info("Notify.Uploading", { n: audio.length });
  for (const file of audio) {
    try {
      const res = await FP.upload(source, target, file, {}, { notify: false });
      const path = res?.path ?? (res?.status === "success" ? `${target}/${file.name}` : null);
      if (path) paths.push(path);
      else console.warn(`${MODULE_ID} | upload returned no path`, file.name, res);
    } catch (err) {
      console.error(`${MODULE_ID} | upload failed`, file.name, err);
      error("Notify.UploadFailed", { file: file.name, error: err.message ?? err });
    }
  }
  if (paths.length) info("Notify.Uploaded", { n: paths.length, folder: target });
  return paths;
}

/** True when a drag event carries files from the desktop. */
export const dragHasFiles = ev => [...(ev.dataTransfer?.types ?? [])].includes("Files");
