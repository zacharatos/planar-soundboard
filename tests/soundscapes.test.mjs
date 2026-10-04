// Soundscape switching, layers, automation and pads, run against the Foundry stub.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { LOG, MISSING_KEYS, pl, snd, boot, flush } from "./helpers/foundry-stub.mjs";

await boot();
const store = await import("../scripts/store.mjs");
const engine = await import("../scripts/engine.mjs");

// Stop scatter timers and fx tickers so the process can exit.
after(async () => { await engine.stopAll({ fadeMs: 0 }); engine.clearAllFilters(); engine.narrate(false); });

await store.upsertScape({ id: "A", name: "Tavern", sceneId: "sc1",
  music: { mode: "track", soundUuid: snd("Music", "Tavern Theme").uuid, volume: 0.4 },
  ambience: [{ soundUuid: snd("Ambience", "Wind").uuid, volume: 0.3 }, { soundUuid: snd("Ambience", "Drips").uuid, volume: 0.2 }],
  scatter: [{ name: "Bell", sources: ["sfx/bell.ogg"], minDelay: 1, maxDelay: 1 }],
  pads: [{ name: "Door", sources: ["sfx/door.ogg"], duck: true }] });
await store.upsertScape({ id: "B", name: "Market",
  music: { mode: "track", soundUuid: snd("Music", "Market Theme").uuid, volume: 0.5 },
  ambience: [{ soundUuid: snd("Ambience", "Wind").uuid, volume: 0.6 }] });
await store.upsertScape({ id: "R", name: "Rain", sticky: true, ambience: [{ soundUuid: snd("Ambience", "Rain").uuid, volume: 0.5 }] });
await store.upsertScape({ id: "C", name: "Combat", music: { mode: "playlist", playlistUuid: pl("Battle").uuid } });
await store.upsertScape({ id: "K", name: "Keep", music: { mode: "keep" } });

test("the global pad bank is created on ready", () => {
  assert.ok(store.getGlobalScape());
  assert.equal(store.getGlobalScape().name, "Global Pads");
});

test("activating a soundscape fades its music and ambience in and takes over hand-started music", async () => {
  snd("Manual", "Hand-started").playing = true;
  await engine.activate("Tavern", { fadeMs: 2000 });
  const theme = snd("Music", "Tavern Theme");
  assert.ok(theme.playing);
  assert.equal(theme.fade, 2000);
  assert.ok(snd("Ambience", "Wind").playing && snd("Ambience", "Drips").playing);
  assert.ok(snd("Ambience", "Wind").repeat, "ambience loops");
  assert.ok(!snd("Manual", "Hand-started").playing);
  assert.equal(store.getState().base, "A");
});

test("switching crossfades in one batched update and keeps shared sounds playing", async () => {
  LOG.length = 0;
  await engine.activate("Market");
  assert.ok(!snd("Music", "Tavern Theme").playing && snd("Music", "Market Theme").playing);
  assert.ok(snd("Ambience", "Wind").playing);
  assert.equal(snd("Ambience", "Wind").volume, 0.6, "shared sound only changes volume");
  assert.ok(!snd("Ambience", "Drips").playing);
  const musicUpdates = LOG.filter(l => l.pl === "Music");
  assert.equal(musicUpdates.length, 1);
  assert.equal(musicUpdates[0].u.sounds.length, 2, "stop and start in the same update");
  const windId = snd("Ambience", "Wind").id;
  assert.ok(!LOG.some(l => l.pl === "Ambience" && l.u.sounds?.some(s => s._id === windId && s.playing === true)), "Wind not restarted");
});

test("layers: shift-click adds, sticky layers survive a switch, a second shift-click removes", async () => {
  await engine.activate("Rain", { additive: true });
  assert.ok(snd("Ambience", "Rain").playing);
  assert.ok(store.getState().overlays.includes("R"));
  await engine.activate("Tavern");
  assert.ok(snd("Ambience", "Rain").playing, "sticky");
  await engine.activate("Rain", { additive: true });
  assert.ok(!snd("Ambience", "Rain").playing);
  assert.ok(!store.getState().overlays.includes("R"));
});

test("Begin Combat switches to the combat soundscape and ending it comes back", async () => {
  await game.settings.set("planar-soundboard", "combatScape", "C");
  engine.onCombatStart();
  await flush();
  assert.ok(pl("Battle").sounds.some(s => s.playing));
  assert.ok(!snd("Music", "Tavern Theme").playing);
  assert.equal(store.getState().combatReturn?.base, "A");
  Hooks.callAll("deleteCombat", { started: true });
  await flush();
  assert.ok(snd("Music", "Tavern Theme").playing);
  assert.ok(!pl("Battle").sounds.some(s => s.playing));
  assert.equal(store.getState().base, "A");
});

test("a 'keep music' soundscape leaves music alone but still clears ambience", async () => {
  await engine.activate("Combat");
  await engine.activate("Keep");
  assert.ok(pl("Battle").sounds.some(s => s.playing));
  assert.ok(!snd("Ambience", "Wind").playing);
});

test("pads broadcast a one-shot and ducking pads send an fx message", async () => {
  LOG.length = 0;
  await engine.playPad(store.findScape("A").pads[0]);
  assert.ok(LOG.some(l => l.oneShot === "sfx/door.ogg" && l.broadcast === true));
  assert.ok(LOG.some(l => l.socket === "fx"));
});

test("narrate toggles", () => {
  assert.equal(engine.narrate(), true);
  assert.ok(engine.fxState().narrate);
  assert.equal(engine.narrate(), false);
});

test("Silence stops everything and clears the state", async () => {
  await engine.stopAll({ fadeMs: 0 });
  assert.equal(engine.playingSounds().length, 0);
  assert.equal(store.getState().base, null);
});

test("activating a linked scene starts its soundscape", async () => {
  Hooks.callAll("updateScene", { id: "sc1" }, { active: true });
  await flush();
  assert.equal(store.getState().base, "A");
});

test("an unknown soundscape warns in plain language", async () => {
  LOG.length = 0;
  await engine.activate("Nowhere");
  assert.ok(LOG.some(l => l.warn === "Planar Soundboard: no soundscape “Nowhere”."), JSON.stringify(LOG));
});

test("the panel and editors render, with every string found in lang/en.json", async () => {
  const { SoundboardPanel } = await import("../scripts/panel.mjs");
  const { ScapeEditor } = await import("../scripts/editor.mjs");
  const p = new SoundboardPanel();
  const html = await p._renderHTML(await p._prepareContext());
  assert.ok(html.includes("Tavern") && html.includes("ps-card base") && html.includes("Door"));
  assert.ok(html.includes("Now playing"));
  for (const id of ["A", "C", "__global__"]) {
    const h = await new ScapeEditor({ scapeId: id })._renderHTML();
    assert.ok(h.length > 500, id);
  }
  const e = new ScapeEditor({ scapeId: "A" });
  e._onDrop("pads", NaN, pl("Battle"));
  assert.equal(e.scape.pads.at(-1).sources.length, 2, "a dropped playlist becomes one pad with variants");
  e._onDrop("music", NaN, pl("Battle"));
  assert.equal(e.scape.music.mode, "playlist");
  assert.deepEqual([...MISSING_KEYS], []);
});

test("the macro API is exposed", () => {
  for (const k of ["open", "activate", "toggleLayer", "stopAll", "playPad", "narrate", "muffle", "filter", "clearFilter", "cue", "go", "play"]) {
    assert.equal(typeof globalThis.PlanarSoundboard[k], "function", k);
  }
  assert.equal(game.modules.get("planar-soundboard").api, globalThis.PlanarSoundboard);
});

test("settings and keybindings are registered with localization keys", () => {
  for (const [k, d] of game.settingDefs) {
    if (d.config) assert.match(d.name, /^PLANAR_SOUNDBOARD\.Settings\./, k);
  }
  assert.ok(game.keybindings.registered.length >= 15);
  for (const kb of game.keybindings.registered) assert.match(kb.name, /^PLANAR_SOUNDBOARD\.Keys\./);
});
