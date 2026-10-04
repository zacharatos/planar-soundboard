// Planar Soundboard — entry point: settings, hooks, keybindings, macro API.

import {
  MODULE_ID, registerSettings, ensureGlobalScape, findScape, getScapes, getState, isActiveGM, activeScapes
} from "./store.mjs";
import * as engine from "./engine.mjs";
import { SoundboardPanel } from "./panel.mjs";
import { ScapeEditor } from "./editor.mjs";
import { CueEditor } from "./cue-editor.mjs";
import * as cues from "./cues.mjs";
import { PRESETS } from "./fxgraph.mjs";
import { key, t, warn } from "./i18n.mjs";

let panel = null;

const refreshUI = foundry.utils.debounce(() => {
  if (panel?.rendered) panel.render();
}, 120);

const api = {
  /** Open (or focus) the soundboard. */
  open() {
    if (!game.user.isGM) return warn("Notify.GMOnly");
    panel ??= new SoundboardPanel();
    panel.render({ force: true });
    return panel;
  },
  toggle() {
    if (panel?.rendered) return panel.close();
    return api.open();
  },
  /** Crossfade to a soundscape by name or id. opts: {fade: seconds, additive: bool} */
  activate(nameOrId, { fade, additive = false } = {}) {
    return engine.activate(nameOrId, { additive, fadeMs: fade == null ? null : fade * 1000 });
  },
  /** Add/remove a soundscape as a layer on top of the current one. */
  toggleLayer(nameOrId, { fade } = {}) {
    return engine.activate(nameOrId, { additive: true, fadeMs: fade == null ? null : fade * 1000 });
  },
  /** Fade everything out. */
  stopAll({ fade } = {}) {
    return engine.stopAll({ fadeMs: fade == null ? null : fade * 1000 });
  },
  /** Trigger a pad by name — searches the active soundscapes, then the global pads, then everything. */
  playPad(padName, scapeNameOrId = null) {
    const wanted = String(padName).toLowerCase();
    const scapes = scapeNameOrId ? [findScape(scapeNameOrId)] : [...activeScapes(), findScape("__global__"), ...getScapes()];
    for (const sc of scapes.filter(Boolean)) {
      const pad = sc.pads.find(p => p.name.toLowerCase() === wanted || p.id === padName);
      if (pad) return engine.playPad(pad);
    }
    warn("Notify.NoPad", { name: padName });
  },
  /** Toggle (or set) narration ducking. */
  narrate: on => engine.narrate(on),
  /** Toggle (or set) the muffle filter for everyone. */
  muffle: on => engine.muffle(on),
  /**
   * Turn a Planar Filter on: PlanarSoundboard.filter("deafened", {targets: ["Aria"], intensity: 1, hold: 6})
   * targets: user ids, user names or character names (empty = everyone). hold: seconds until it turns itself off.
   */
  filter: (preset, { targets = [], intensity = 1, hold, fadeIn, fadeOut } = {}) => engine.setFilter(preset, {
    targets, intensity,
    hold: hold == null ? undefined : hold * 1000,
    fadeIn: fadeIn == null ? undefined : fadeIn * 1000,
    fadeOut: fadeOut == null ? undefined : fadeOut * 1000
  }),
  /** Turn a filter off — for these targets, or every instance of it when no targets are given. */
  clearFilter: (preset, { targets } = {}) => (preset ? engine.clearPreset(preset, targets ?? null) : engine.clearAllFilters()),
  /** Names of the filter presets. */
  filters: () => Object.keys(PRESETS),
  /** Fire a cue by name (any list). */
  cue: name => cues.fireByName(name),
  /** Fire the next cue of the current list. */
  go: () => cues.go(),
  /** Play any file for everyone: PlanarSoundboard.play("path.ogg", {volume, channel}) */
  play: (src, opts = {}) => engine.playOneShot(src, opts),
  /** Names of all soundscapes. */
  list: () => getScapes().map(s => s.name),
  /** Current state. */
  state: () => ({ ...getState(), ...engine.fxState() }),
  editCues(listName) {
    const l = cues.getCueLists().find(x => x.name === listName || x.id === listName) ?? cues.currentList();
    if (l) new CueEditor({ listId: l.id }).render({ force: true });
  },
  edit(nameOrId) {
    const sc = findScape(nameOrId);
    if (sc) new ScapeEditor({ scapeId: sc.id }).render({ force: true });
  }
};

Hooks.once("init", () => {
  registerSettings(refreshUI);

  // Keybinding names are localization keys; Foundry localizes them in Configure Controls.
  const kb = (id, editable, onDown) => game.keybindings.register(MODULE_ID, id, {
    name: key(`Keys.${id}`), editable, restricted: true, precedence: CONST.KEYBINDING_PRECEDENCE.NORMAL,
    onDown: () => { onDown(); return true; }
  });
  kb("open", [{ key: "KeyS", modifiers: ["Alt"] }], () => api.toggle());
  kb("narrate", [{ key: "KeyN", modifiers: ["Alt"] }], () => engine.narrate());
  kb("muffle", [{ key: "KeyM", modifiers: ["Alt"] }], () => engine.muffle());
  kb("silence", [], () => engine.stopAll());
  kb("cueGo", [{ key: "KeyG", modifiers: ["Alt"] }], () => cues.go());
  kb("cueBack", [{ key: "KeyG", modifiers: ["Alt", "Shift"] }], () => cues.back());

  // Journal links: @Cue[name]{label} and @Scape[name]{label} become ▶ buttons (GM only).
  CONFIG.TextEditor.enrichers.push({
    pattern: /@(Cue|Scape)\[([^\]]+)\](?:\{([^}]+)\})?/gi,
    enricher: async match => {
      const span = document.createElement("span");
      if (!game.user.isGM) return span;
      const [, kind, name, label] = match;
      const a = document.createElement("a");
      a.className = `ps-cue-link ps-${kind.toLowerCase()}-link`;
      a.dataset.kind = kind.toLowerCase();
      a.dataset.name = name;
      a.dataset.tooltip = t(kind.toLowerCase() === "cue" ? "Links.CueTooltip" : "Links.ScapeTooltip");
      a.innerHTML = `<i class="fa-solid ${kind.toLowerCase() === "cue" ? "fa-play" : "fa-music"}"></i> ${foundry.utils.escapeHTML?.(label ?? name) ?? (label ?? name)}`;
      return a;
    }
  });
  for (let i = 1; i <= 9; i++) {
    kb(`pad${i}`, [{ key: `Digit${i}`, modifiers: ["Alt"] }], () => {
      const entry = engine.hotkeyPads()[i - 1];
      if (entry) engine.playPad(entry.pad);
    });
  }
});

Hooks.once("ready", async () => {
  engine.registerSocket();
  const mod = game.modules.get(MODULE_ID);
  mod.api = api;
  globalThis.PlanarSoundboard = api;

  if (!game.user.isGM) return;
  await ensureGlobalScape();
  if (isActiveGM()) engine.resumeScatter();
});

// Keep the UI live as playlists change.
for (const hook of ["updatePlaylistSound", "createPlaylistSound", "deletePlaylistSound", "updatePlaylist", "createPlaylist", "deletePlaylist"]) {
  Hooks.on(hook, () => refreshUI());
}
Hooks.on(`${MODULE_ID}.fxChanged`, () => refreshUI());
Hooks.on(`${MODULE_ID}.padsChanged`, () => refreshUI());
Hooks.on(`${MODULE_ID}.cuesChanged`, () => refreshUI());

// Clicks on @Cue / @Scape journal links.
document.addEventListener("click", ev => {
  const link = ev.target?.closest?.("a.ps-cue-link");
  if (!link || !game.user?.isGM) return;
  ev.preventDefault();
  ev.stopPropagation();
  if (link.dataset.kind === "cue") cues.fireByName(link.dataset.name);
  else engine.activate(link.dataset.name);
}, true);

// Automation.
Hooks.on("updateScene", (scene, changes) => {
  if (changes.active === true) engine.onSceneActivated(scene);
});
Hooks.on("combatStart", () => engine.onCombatStart());
Hooks.on("deleteCombat", combat => { if (combat.started) engine.onCombatEnd(); });

// Late joiners get the current narrate/muffle state.
Hooks.on("userConnected", (user, connected) => {
  if (connected && isActiveGM() && user.id !== game.user.id) setTimeout(() => engine.resyncFx(), 4000);
});

// A button in the Playlists sidebar.
Hooks.on("renderPlaylistDirectory", (app, html) => {
  if (!game.user.isGM) return;
  const root = html instanceof HTMLElement ? html : html?.[0];
  if (!root || root.querySelector(".planar-soundboard-open")) return;
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "planar-soundboard-open";
  btn.innerHTML = `<i class="fa-solid fa-sliders"></i> ${t("Sidebar.Open")}`;
  btn.addEventListener("click", ev => { ev.preventDefault(); api.open(); });
  const host = root.querySelector(".header-actions") ?? root.querySelector(".directory-header") ?? root;
  host.prepend(btn);
});
