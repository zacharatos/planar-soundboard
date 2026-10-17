// Planar Soundboard — Cues: prepared bundles of actions, run in order with GO,
// from journal links (@Cue[...]) or from macros.

import { MODULE_ID, GLOBAL_ID, randomId, getSetting, setSetting, findScape, getState, clamp, scapePaths, isActiveGM } from "./store.mjs";
import * as engine from "./engine.mjs";
import { PRESETS } from "./fxgraph.mjs";
import { t, info, warn } from "./i18n.mjs";

const wait = ms => new Promise(r => setTimeout(r, ms));

// Labels are in lang/*.json as Cues.Actions.<type>.
export const ACTION_TYPES = {
  scape:   { icon: "fa-solid fa-music" },
  pad:     { icon: "fa-solid fa-table-cells" },
  filter:  { icon: "fa-solid fa-wand-magic-sparkles" },
  narrate: { icon: "fa-solid fa-microphone-lines" },
  play:    { icon: "fa-solid fa-file-audio" },
  macro:   { icon: "fa-solid fa-code" },
  wait:    { icon: "fa-solid fa-hourglass" },
  silence: { icon: "fa-solid fa-volume-xmark" }
};
export const actionLabel = type => (type in ACTION_TYPES ? t(`Cues.Actions.${type}`) : type);
const presetLabel = id => (id in PRESETS ? t(`Filters.${id}.Label`) : id);

/* ---------------------------------------- */
/*  Data                                    */
/* ---------------------------------------- */

const num = (v, d) => (v === null || v === undefined || v === "" || Number.isNaN(Number(v)) ? d : Number(v));

export function normAction(a = {}) {
  const type = a.type in ACTION_TYPES ? a.type : "scape";
  const base = { id: a.id || randomId(), type };
  switch (type) {
    case "scape": return { ...base, scapeId: a.scapeId || "", mode: ["switch", "layerOn", "layerOff"].includes(a.mode) ? a.mode : "switch", fade: a.fade === "" || a.fade == null ? null : Math.max(0, Number(a.fade)) };
    case "pad": {
      let { scapeId = "", padId = "" } = a;
      if (a.padKey) [scapeId, padId] = String(a.padKey).split("|");
      return { ...base, scapeId, padId };
    }
    case "filter": return { ...base, preset: a.preset in PRESETS ? a.preset : "muffled", on: a.on !== false && a.on !== "false",
      targets: Array.isArray(a.targets) ? a.targets.filter(Boolean) : [], intensity: clamp(num(a.intensity, 1), 0, 1) };
    case "narrate": return { ...base, on: a.on !== false && a.on !== "false" };
    case "play": return { ...base, src: a.src || "", volume: clamp(num(a.volume, 0.8), 0, 1), channel: a.channel || "interface" };
    case "macro": return { ...base, macroUuid: a.macroUuid || "" };
    case "wait": return { ...base, seconds: Math.max(0, num(a.seconds, 2)) };
    case "silence": return { ...base, fade: a.fade === "" || a.fade == null ? null : Math.max(0, Number(a.fade)) };
  }
  return base;
}

export function normCue(c = {}) {
  return {
    id: c.id || randomId(),
    name: c.name || t("Defaults.Cue"),
    color: c.color || "",
    notes: c.notes || "",
    autoFollow: c.autoFollow === "" || c.autoFollow == null ? null : Math.max(0, Number(c.autoFollow)),
    actions: (c.actions ?? []).map(normAction)
  };
}

export function normCueList(l = {}) {
  return { id: l.id || randomId(), name: l.name || t("Defaults.CueList"), cues: (l.cues ?? []).map(normCue) };
}

export function getCueLists() {
  return foundry.utils.deepClone(getSetting("cueLists") ?? []).map(normCueList);
}

export async function saveCueLists(lists) {
  return setSetting("cueLists", lists.map(normCueList));
}

export async function upsertCueList(list) {
  const all = getCueLists();
  const i = all.findIndex(l => l.id === list.id);
  if (i >= 0) all[i] = normCueList(list); else all.push(normCueList(list));
  return saveCueLists(all);
}

export async function deleteCueList(id) {
  await saveCueLists(getCueLists().filter(l => l.id !== id));
  const run = getRun();
  if (run.listId === id) await setRun({ listId: getCueLists()[0]?.id ?? null, index: 0, last: null });
}

export function getRun() {
  const r = getSetting("cueRun") ?? {};
  return { listId: r.listId ?? null, index: Math.max(0, Number(r.index) || 0), last: r.last ?? null };
}

export const setRun = run => setSetting("cueRun", { listId: run.listId ?? null, index: run.index ?? 0, last: run.last ?? null });

export function currentList() {
  const lists = getCueLists();
  const run = getRun();
  return lists.find(l => l.id === run.listId) ?? lists[0] ?? null;
}

/** Find a cue by name or id: the current list first, then every list. */
export function findCue(nameOrId) {
  const key = String(nameOrId).toLowerCase();
  const lists = getCueLists();
  const cur = currentList();
  const order = cur ? [cur, ...lists.filter(l => l.id !== cur.id)] : lists;
  for (const l of order) {
    const c = l.cues.find(c => c.id === nameOrId || c.name.toLowerCase() === key);
    if (c) return { list: l, cue: c, index: l.cues.indexOf(c) };
  }
  return null;
}

/* ---------------------------------------- */
/*  Running                                 */
/* ---------------------------------------- */

let running = null;        // id of the cue currently executing
let followTimer = null;
export const runningCueId = () => running;

function cancelFollow() {
  clearTimeout(followTimer);
  followTimer = null;
}

/** Every audio file a cue can start: its soundscapes (switch / layer on), pads and played files. */
export function cuePaths(cue) {
  const out = new Set();
  for (const a of cue?.actions ?? []) {
    if (a.type === "scape" && a.mode !== "layerOff") {
      const sc = findScape(a.scapeId);
      if (sc) for (const p of scapePaths(sc)) out.add(p);
    } else if (a.type === "pad") {
      const pad = findScape(a.scapeId || GLOBAL_ID)?.pads.find(p => p.id === a.padId);
      for (const p of pad?.sources ?? []) out.add(p);
    } else if (a.type === "play" && a.src) out.add(a.src);
  }
  return [...out];
}

/** Preload the cue the GO pointer now sits on, so its sounds are ready when it fires. */
const NEXT_CUE_DELAY_MS = 5000;
let preloadTimer = null;
function preloadNext(listId, index, delay = 0) {
  clearTimeout(preloadTimer);
  if (!isActiveGM()) return;
  preloadTimer = setTimeout(() => {
    const cue = getCueLists().find(l => l.id === listId)?.cues[index];
    if (cue) engine.preloadPaths(cuePaths(cue));
  }, delay);
}

/** Execute a cue's actions in order. */
export async function fireCue(cue) {
  if (!cue) return;
  running = cue.id;
  Hooks.callAll(`${MODULE_ID}.cuesChanged`);
  try {
    for (const a of cue.actions) {
      try { await runAction(a); }
      catch (err) {
        console.error(`${MODULE_ID} | cue "${cue.name}" action ${a.type} failed`, err);
        warn("Notify.CueActionFailed", { cue: cue.name, action: actionLabel(a.type), error: err.message ?? err });
      }
    }
  } finally {
    if (running === cue.id) running = null;
    Hooks.callAll(`${MODULE_ID}.cuesChanged`);
  }
}

async function runAction(a) {
  const fadeMs = s => (s == null ? null : s * 1000);
  switch (a.type) {
    case "scape": {
      if (!a.scapeId) return;
      const st = getState();
      if (a.mode === "switch") return engine.activate(a.scapeId, { fadeMs: fadeMs(a.fade) });
      if (a.mode === "layerOn") {
        if (st.base === a.scapeId || st.overlays.includes(a.scapeId)) return;
        return engine.activate(a.scapeId, { additive: true, fadeMs: fadeMs(a.fade) });
      }
      if (a.mode === "layerOff") return engine.deactivateOverlay(a.scapeId, { fadeMs: fadeMs(a.fade) });
      return;
    }
    case "pad": {
      const sc = findScape(a.scapeId || GLOBAL_ID);
      const pad = sc?.pads.find(p => p.id === a.padId);
      if (!pad) throw new Error(t("Cues.PadNotFound"));
      return engine.playPad(pad);
    }
    case "filter":
      if (a.on) engine.setFilter(a.preset, { targets: a.targets, intensity: a.intensity });
      else engine.clearPreset(a.preset, a.targets.length ? a.targets : null);
      return;
    case "narrate": engine.narrate(a.on); return;
    case "play": return engine.playOneShot(a.src, { volume: a.volume, channel: a.channel });
    case "macro": {
      const m = (a.macroUuid && (fromUuidSync(a.macroUuid) || game.macros?.get(a.macroUuid.split(".").pop())))
        || game.macros?.getName?.(a.macroUuid);
      if (!m) throw new Error(t("Cues.MacroNotFound"));
      return m.execute();
    }
    case "wait": return wait(a.seconds * 1000);
    case "silence": return engine.stopAll({ fadeMs: fadeMs(a.fade) });
  }
}

/** Fire the cue at a position of a list, move the pointer past it, handle auto-follow. */
export async function fireAt(listId, index) {
  cancelFollow();
  const list = getCueLists().find(l => l.id === listId);
  const cue = list?.cues[index];
  if (!cue) return;
  await setRun({ listId, index: index + 1, last: index });
  await fireCue(cue);
  // The next cue's files, once this cue's own sounds have had the bandwidth.
  preloadNext(listId, index + 1, NEXT_CUE_DELAY_MS);
  if (cue.autoFollow != null && index + 1 < list.cues.length) {
    followTimer = setTimeout(() => {
      const run = getRun();
      if (run.listId === listId && run.index === index + 1) fireAt(listId, index + 1);
    }, cue.autoFollow * 1000);
  }
}

/** GO: fire the next cue of the current list. */
export async function go() {
  const list = currentList();
  if (!list) return info("Notify.NoCueList");
  const run = getRun();
  const index = run.listId === list.id ? run.index : 0;
  if (index >= list.cues.length) return info("Notify.CueListEnd", { name: list.name });
  return fireAt(list.id, index);
}

/** Move the "next" pointer without firing. */
export async function standby(listId, index) {
  cancelFollow();
  const list = getCueLists().find(l => l.id === listId);
  if (!list) return;
  const run = getRun();
  const next = Math.max(0, Math.min(index, list.cues.length));
  await setRun({ listId, index: next, last: run.listId === listId ? run.last : null });
  preloadNext(listId, next);
}

export async function back() {
  const run = getRun();
  const list = currentList();
  if (list) await standby(list.id, (run.listId === list.id ? run.index : 0) - 1);
}

/** Fire a cue by name — used by journal links and macros (does not move the GO pointer). */
export async function fireByName(nameOrId) {
  const hit = findCue(nameOrId);
  if (!hit) return warn("Notify.NoCue", { name: nameOrId });
  return fireCue(hit.cue);
}

/** One-line description of an action, for the cue list. */
export function describeAction(a) {
  const scape = id => findScape(id)?.name ?? "?";
  switch (a.type) {
    case "scape": return `${{ switch: "→", layerOn: "+", layerOff: "−" }[a.mode]} ${scape(a.scapeId)}`;
    case "pad": return `▣ ${findScape(a.scapeId || GLOBAL_ID)?.pads.find(p => p.id === a.padId)?.name ?? "?"}`;
    case "filter": {
      const label = `${a.on ? "" : "✕ "}${presetLabel(a.preset)}`;
      return a.targets.length ? t("Cues.Describe.FilterPlayers", { label, n: a.targets.length }) : label;
    }
    case "narrate": return t(a.on ? "Cues.Describe.NarrateOn" : "Cues.Describe.NarrateOff");
    case "play": return `♪ ${String(a.src).split("/").pop()}`;
    case "macro": return `⚙ ${(fromUuidSync(a.macroUuid) ?? game.macros?.get(String(a.macroUuid).split(".").pop()))?.name ?? t("Cues.Actions.macro")}`;
    case "wait": return `⏱ ${a.seconds}s`;
    case "silence": return actionLabel("silence");
  }
  return a.type;
}
