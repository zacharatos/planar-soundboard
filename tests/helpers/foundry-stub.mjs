// A small stand-in for the Foundry globals the module touches, so its logic can run in Node.
// Import this BEFORE any module file. Each test file runs in its own process (node --test),
// so every file starts from a fresh world.
import { readFileSync } from "node:fs";

export const LOG = [];
export const MISSING_KEYS = new Set();

let idc = 0;
const rid = () => `id${++idc}`;

export class Coll extends Map {
  constructor(arr = []) { super(arr.map(d => [d.id, d])); }
  get contents() { return [...this.values()]; }
  find(f) { return this.contents.find(f); }
  filter(f) { return this.contents.filter(f); }
  some(f) { return this.contents.some(f); }
  map(f) { return this.contents.map(f); }
  [Symbol.iterator]() { return this.values(); }
}

class PlaylistSound {
  constructor(pl, d) {
    Object.assign(this, { id: rid(), playing: false, volume: 0.5, fade: null, channel: "", repeat: false,
      path: `sounds/${d.name}.ogg`, documentName: "PlaylistSound" }, d);
    this.parent = pl;
    this.uuid = `Playlist.${pl.id}.PlaylistSound.${this.id}`;
  }
}

class Playlist {
  constructor(d) {
    Object.assign(this, { id: rid(), channel: "music", mode: 0, playing: false, fade: null, documentName: "Playlist", flags: {} }, d);
    this.uuid = `Playlist.${this.id}`;
    this.sounds = new Coll((d.sounds ?? []).map(s => new PlaylistSound(this, s)));
  }
  get playbackOrder() { return this.sounds.contents.map(s => s.id); }
  getFlag(scope, k) { return this.flags?.[scope]?.[k]; }
  async update(u) {
    LOG.push({ pl: this.name, u: JSON.parse(JSON.stringify(u)) });
    for (const [k, v] of Object.entries(u)) if (k !== "sounds") this[k] = v;
    for (const su of u.sounds ?? []) Object.assign(this.sounds.get(su._id), su);
  }
  async playAll() {
    LOG.push({ pl: this.name, playAll: true });
    this.sounds.contents[0].playing = true;
    this.playing = true;
  }
  async playNext() {}
  async createEmbeddedDocuments(type, arr) {
    return arr.map(d => { const s = new PlaylistSound(this, d); this.sounds.set(s.id, s); index(s); return s; });
  }
}

const byUuid = new Map();
const index = doc => byUuid.set(doc.uuid, doc);
const playlists = new Coll([
  new Playlist({ name: "Music", sounds: [{ name: "Tavern Theme" }, { name: "Market Theme" }] }),
  new Playlist({ name: "Ambience", channel: "environment", mode: 2,
    sounds: [{ name: "Wind", channel: "environment" }, { name: "Drips", channel: "environment" }, { name: "Rain", channel: "environment" }] }),
  new Playlist({ name: "Battle", mode: 1, sounds: [{ name: "Fight 1" }, { name: "Fight 2" }] }),
  new Playlist({ name: "Manual", sounds: [{ name: "Hand-started" }] })
]);
for (const p of playlists) { index(p); for (const s of p.sounds) index(s); }
globalThis.fromUuidSync = u => byUuid.get(u) ?? null;

/* ---- localization: the real lang/en.json, with missing keys recorded ---- */
const EN = JSON.parse(readFileSync(new URL("../../lang/en.json", import.meta.url), "utf8"));
const lookup = k => k.split(".").reduce((o, part) => (o && typeof o === "object" ? o[part] : undefined), EN);
const i18n = {
  localize(k) {
    const v = lookup(k);
    if (typeof v !== "string") { MISSING_KEYS.add(k); return k; }
    return v;
  },
  format(k, data = {}) {
    return i18n.localize(k).replace(/\{(\w+)\}/g, (m, name) => (name in data ? String(data[name]) : m));
  }
};

const settings = new Map();
const defs = new Map();

globalThis.game = {
  i18n,
  user: { id: "gm", isGM: true, can: () => true },
  users: Object.assign(new Coll([
    { id: "gm", name: "GM", isGM: true, active: true },
    { id: "u1", name: "Alex", isGM: false, active: true, character: { name: "Aria" }, color: "#ff8800" },
    { id: "u2", name: "Sam", isGM: false, active: false, character: { name: "Borin" } }
  ]), { activeGM: { id: "gm", isSelf: true } }),
  macros: Object.assign(new Coll([
    { id: "m1", uuid: "Macro.m1", name: "Show the tavern", execute: async () => LOG.push({ macro: "m1" }) }
  ]), { getName(n) { return this.find(m => m.name === n); } }),
  playlists,
  scenes: new Coll([{ id: "sc1", name: "Tavern" }]),
  combats: [],
  world: { id: "w" },
  settings: {
    register(m, k, d) { defs.set(k, d); if (!settings.has(k)) settings.set(k, structuredClone(d.default)); },
    get(m, k) { return structuredClone(settings.get(k)); },
    async set(m, k, v) { settings.set(k, structuredClone(v)); defs.get(k)?.onChange?.(v); return v; }
  },
  settingDefs: defs,
  socket: { on(ch, f) { this.handler = f; }, emit(ch, m) { LOG.push({ socket: m.action, msg: m }); } },
  audio: { playing: new Map(), async preload(p) { LOG.push({ preload: p }); } },
  keybindings: { registered: [], register(m, k, d) { this.registered.push({ key: k, ...d }); } },
  modules: new Map([["planar-soundboard", {}]])
};

globalThis.CONST = {
  PLAYLIST_MODES: { DISABLED: -1, SEQUENTIAL: 0, SHUFFLE: 1, SIMULTANEOUS: 2 },
  KEYBINDING_PRECEDENCE: { NORMAL: 1 }
};
globalThis.document ??= { addEventListener() {}, createElement: () => ({ dataset: {} }) };
globalThis.CONFIG = {
  TextEditor: { enrichers: [] },
  Playlist: { documentClass: { create: async d => { const p = new Playlist(d); playlists.set(p.id, p); index(p); return p; } } }
};
globalThis.ui = { notifications: {
  warn: m => LOG.push({ warn: m }), info: m => LOG.push({ info: m }), error: m => LOG.push({ error: m })
} };

const hooks = {};
globalThis.Hooks = {
  on(n, f) { (hooks[n] ??= []).push(f); },
  once(n, f) { (hooks[n] ??= []).push(f); },
  callAll(n, ...a) { (hooks[n] ?? []).forEach(f => f(...a)); },
  _h: hooks
};

class ApplicationV2 {
  constructor(o = {}) { this.options = o; }
  async render() { this.rendered = true; return this; }
  async close() { this.rendered = false; }
}

globalThis.foundry = {
  utils: {
    randomID: () => Math.random().toString(36).slice(2, 12),
    deepClone: o => structuredClone(o),
    debounce: f => f,
    escapeHTML: s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]),
    getProperty: (o, path) => path.split(".").reduce((x, k) => x?.[k], o),
    setProperty(o, path, v) { const ks = path.split("."); let x = o; while (ks.length > 1) x = x[ks.shift()]; x[ks[0]] = v; },
    saveDataToFile() {}
  },
  audio: { AudioHelper: {
    play: async (d, broadcast) => { LOG.push({ oneShot: d.src, broadcast, channel: d.channel }); return { duration: 1.2, stop() {} }; },
    preloadSound: async src => { LOG.push({ localPreload: src }); },
    getDefaultSoundName: p => p.split("/").pop()
  } },
  applications: {
    apps: { FilePicker: { implementation: {
      createDirectory: async (src, p) => { LOG.push({ mkdir: p }); },
      upload: async (src, target, file) => ({ status: "success", path: `${target}/${file.name}` })
    } } },
    api: { ApplicationV2, DialogV2: { confirm: async () => true } }
  }
};

export const pl = name => game.playlists.find(p => p.name === name);
export const snd = (p, name) => pl(p).sounds.find(s => s.name === name);

/** Load the module the way Foundry does: import main, run init then ready. */
export async function boot() {
  await import("../../scripts/main.mjs");
  for (const f of Hooks._h.init ?? []) await f();
  for (const f of Hooks._h.ready ?? []) await f();
}

/** Wait for the engine's activation queue to drain. */
export async function flush() {
  const engine = await import("../../scripts/engine.mjs");
  await engine.activate("__flush__");
  const i = LOG.findIndex(l => l.warn?.includes("__flush__"));
  if (i >= 0) LOG.splice(i, 1);
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));
