// Planar Soundboard — client side of Planar Filters: puts filter nodes into the
// effect pipeline of every playing Sound on this client, per the GM's broadcast state.

import { MODULE_ID } from "./store.mjs";
import { PRESETS, createFilterNode, setFilterLevel, startTinnitus } from "./fxgraph.mjs";

const CHANNEL_KEYS = ["music", "environment", "interface"];

const local = {
  filters: {},          // id -> spec, only the ones that apply to this user
  tinnitus: new Map(),  // id -> stop()
  ticker: null
};

export const localFilters = () => ({ ...local.filters });

/** Normalise a filter spec (GM side, before broadcast). */
export function normFilterSpec(presetId, opts = {}) {
  const preset = PRESETS[presetId];
  if (!preset) throw new Error(`Unknown filter "${presetId}"`);
  const targets = [...new Set((opts.targets ?? []).filter(Boolean))].sort();
  return {
    id: opts.id ?? filterId(presetId, targets),
    preset: presetId,
    targets,
    intensity: Math.min(1, Math.max(0, opts.intensity ?? 1)),
    channels: opts.channels ?? preset.channels,
    fadeIn: opts.fadeIn ?? preset.fadeIn,
    fadeOut: opts.fadeOut ?? preset.fadeOut,
    hold: opts.hold ?? preset.hold ?? null,
    cutoff: opts.cutoff ?? null
  };
}

export const filterId = (presetId, targets = []) => `${presetId}@${targets.length ? [...targets].sort().join(",") : "all"}`;

/** Apply a full filter state received from the GM. */
export function receiveFilters(all = {}) {
  const me = game.user?.id;
  const mine = Object.values(all).filter(f => PRESETS[f.preset] && (!f.targets?.length || f.targets.includes(me)));
  const next = Object.fromEntries(mine.map(f => [f.id, f]));
  const added = new Set(Object.keys(next).filter(id => !(id in local.filters)));
  const removed = Object.keys(local.filters).filter(id => !(id in next));
  local.filters = next;

  for (const id of added) {
    const spec = next[id];
    if (PRESETS[spec.preset].tinnitus) {
      try {
        const ctx = game.audio?.interface ?? game.audio?.music;
        if (ctx) local.tinnitus.set(id, startTinnitus(ctx, { holdMs: spec.hold ?? 4000, fadeOutMs: spec.fadeOut }));
      } catch (err) { console.warn(`${MODULE_ID} | tinnitus failed`, err); }
    }
  }
  for (const id of removed) {
    local.tinnitus.get(id)?.(800);
    local.tinnitus.delete(id);
  }

  applyAll(added);
  const active = Object.keys(local.filters).length > 0;
  if (active && !local.ticker) local.ticker = setInterval(() => applyAll(), 500);
  if (!active && local.ticker) { clearInterval(local.ticker); local.ticker = null; }
}

function channelOfContext(ctx) {
  for (const ch of CHANNEL_KEYS) if (game.audio?.[ch] === ctx) return ch;
  return null;
}

function playingSoundObjects() {
  const set = new Set();
  for (const s of game.audio?.playing?.values?.() ?? []) set.add(s);
  for (const pl of game.playlists ?? []) for (const ps of pl.sounds) if (ps.playing && ps.sound) set.add(ps.sound);
  return [...set].filter(s => s && typeof s.applyEffects === "function" && s.context);
}

function reapply(snd) {
  const ours = [...(snd._psFx?.values() ?? [])];
  const others = (snd.effects ?? []).filter(e => !e?._ps);
  try { snd.applyEffects([...others, ...ours]); }
  catch (err) { console.warn(`${MODULE_ID} | could not apply filter`, err); }
}

/** Reconcile every playing Sound with the active filters. */
export function applyAll(justAdded = new Set()) {
  for (const snd of playingSoundObjects()) {
    const ch = channelOfContext(snd.context);
    snd._psFx ??= new Map();
    let changed = false;

    // Fade out filters that no longer apply to this sound.
    for (const [id, node] of snd._psFx) {
      const spec = local.filters[id];
      if (spec && spec.channels.includes(ch)) continue;
      if (node._ps.removing) continue;
      node._ps.removing = true;
      const fadeOut = node._ps.spec.fadeOut;
      setFilterLevel(node, 0, fadeOut);
      setTimeout(() => {
        if (!node._ps.removing || snd._psFx?.get(id) !== node) return;
        snd._psFx.delete(id);
        reapply(snd);
        node._ps.stop();
      }, fadeOut + 80);
    }

    // Bring in (or update) the filters that do apply.
    for (const spec of Object.values(local.filters)) {
      if (!ch || !spec.channels.includes(ch)) continue;
      const existing = snd._psFx.get(spec.id);
      if (existing) {
        if (existing._ps.removing) {
          existing._ps.removing = false;
          setFilterLevel(existing, spec.intensity, spec.fadeIn);
        } else if (existing._ps.intensity !== spec.intensity) {
          setFilterLevel(existing, spec.intensity, 500);
        }
        existing._ps.intensity = spec.intensity;
        existing._ps.spec = spec;
        if (!(snd.effects ?? []).includes(existing)) changed = true; // something else replaced the pipeline
        continue;
      }
      let node;
      try { node = createFilterNode(snd.context, spec.preset, { cutoff: spec.cutoff ?? undefined }); }
      catch (err) { console.warn(`${MODULE_ID} | filter build failed`, err); continue; }
      node._ps.spec = spec;
      node._ps.intensity = spec.intensity;
      snd._psFx.set(spec.id, node);
      changed = true;
      // Sounds that start while a filter is already on get it immediately.
      setFilterLevel(node, spec.intensity, justAdded.has(spec.id) ? spec.fadeIn : 0);
    }
    if (changed) reapply(snd);
  }
}
