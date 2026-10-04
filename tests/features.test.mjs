// Planar Filters, cue lists, uploads and journal links, run against the Foundry stub.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { LOG, MISSING_KEYS, pl, snd, boot, sleep } from "./helpers/foundry-stub.mjs";

await boot();
const store = await import("../scripts/store.mjs");
const engine = await import("../scripts/engine.mjs");
const cues = await import("../scripts/cues.mjs");

after(async () => { await engine.stopAll({ fadeMs: 0 }); engine.clearAllFilters(); engine.narrate(false); });

await store.upsertScape({ id: "A", name: "Tavern", music: { mode: "track", soundUuid: snd("Music", "Tavern Theme").uuid },
  pads: [{ id: "p1", name: "Door", sources: ["sfx/door.ogg"] }] });
await store.upsertScape({ id: "U", name: "Crypt", filter: { preset: "cavern", intensity: 0.8 },
  ambience: [{ soundUuid: snd("Ambience", "Drips").uuid }] });

test("filters: targets accept character names and are per target", () => {
  LOG.length = 0;
  const id = engine.setFilter("memory", { targets: ["Aria"] });
  assert.equal(id, "memory@u1");
  assert.ok(LOG.some(l => l.socket === "fx"), "broadcast");
  assert.ok(engine.isFilterOn("memory", ["u1"]));
  assert.ok(!engine.isFilterOn("memory", []));
  assert.equal(engine.toggleFilter("memory", { targets: ["u1"] }), false);
  assert.equal(engine.fxState().filters.length, 0);
});

test("filters: Muffle is the Muffled preset with the cutoff setting", () => {
  engine.muffle(true);
  assert.ok(engine.fxState().muffle);
  assert.equal(engine.fxState().filters[0].cutoff, 700);
  engine.muffle(false);
});

test("filters: a hold turns the filter off by itself", async () => {
  engine.setFilter("deafened", { targets: ["u2"], hold: 30 });
  await sleep(60);
  assert.equal(engine.fxState().filters.length, 0);
});

test("filters: a soundscape carries its filter while it is active", async () => {
  await engine.activate("Crypt");
  assert.ok(engine.fxState().filters.some(f => f.id === "scape:U" && f.preset === "cavern" && f.intensity === 0.8));
  await engine.activate("Tavern");
  assert.ok(!engine.fxState().filters.some(f => f.id.startsWith("scape:")));
});

const list = cues.normCueList({ id: "L1", name: "Session 1", cues: [
  { name: "Open", actions: [{ type: "scape", scapeId: "U", mode: "switch", fade: 0.5 }, { type: "macro", macroUuid: "Macro.m1" }] },
  { name: "Door", autoFollow: 0, actions: [{ type: "pad", padKey: "A|p1" }, { type: "filter", preset: "muffled", on: "true", targets: [] }] },
  { name: "Quiet", actions: [{ type: "wait", seconds: 0.01 }, { type: "filter", preset: "muffled", on: "false" }, { type: "narrate", on: "true" }] },
  { name: "End", actions: [{ type: "silence", fade: 0 }] }
] });

test("cues: actions normalise (pad keys, string booleans)", () => {
  assert.equal(list.cues[1].actions[0].scapeId, "A");
  assert.equal(list.cues[1].actions[0].padId, "p1");
  assert.equal(list.cues[1].actions[1].on, true);
  assert.equal(list.cues[2].actions[1].on, false);
});

test("cues: GO fires in order, auto-follow chains, back moves the pointer", async () => {
  await cues.upsertCueList(list);
  await cues.standby("L1", 0);
  LOG.length = 0;
  await cues.go();
  assert.equal(store.getState().base, "U");
  assert.ok(LOG.some(l => l.macro === "m1"));
  assert.equal(cues.getRun().index, 1);
  await cues.go();
  await sleep(80);
  assert.ok(LOG.some(l => l.oneShot === "sfx/door.ogg"));
  assert.equal(cues.getRun().index, 3, "auto-follow fired cue 3");
  assert.ok(!engine.fxState().filters.some(f => f.preset === "muffled"));
  assert.ok(engine.fxState().narrate);
  await cues.back();
  assert.equal(cues.getRun().index, 2);
});

test("cues: firing by name (journal links, macros) does not move the GO pointer", async () => {
  await cues.fireByName("end");
  assert.equal(store.getState().base, null);
  assert.equal(cues.getRun().index, 2);
  engine.narrate(false);
});

test("cues: describeAction gives readable summaries", () => {
  const d = list.cues.flatMap(c => c.actions).map(cues.describeAction);
  assert.ok(d.includes("→ Crypt"));
  assert.ok(d.includes("⚙ Show the tavern"));
  assert.ok(d.includes("▣ Door"));
  assert.ok(d.includes("Narrate on"));
});

test("uploads: non-audio files are skipped and each soundscape gets a folder", async () => {
  const paths = await store.uploadAudioFiles([{ name: "Thunder.ogg", type: "audio/ogg" }, { name: "notes.txt", type: "text/plain" }], "Old Crypt");
  assert.deepEqual(paths, ["soundboard-uploads/old-crypt/Thunder.ogg"]);
  assert.equal(store.slugify("Παλιά Κρύπτη 2"), "παλια-κρυπτη-2");
});

test("uploads: dropping files on a pad bank creates one pad per file", async () => {
  const { SoundboardPanel } = await import("../scripts/panel.mjs");
  const p = new SoundboardPanel();
  await p._onBankDrop("A", { dataTransfer: { types: ["Files"], files: [{ name: "bell.mp3", type: "audio/mpeg" }] } });
  assert.ok(store.findScape("A").pads.some(pd => pd.sources[0] === "soundboard-uploads/tavern/bell.mp3"));
});

test("journal links: the @Cue / @Scape enricher is registered", () => {
  const enr = CONFIG.TextEditor.enrichers[0];
  assert.ok(enr);
  const m = "@Cue[Door]{Open the door}".match(new RegExp(enr.pattern.source, "i"));
  assert.deepEqual([m[1], m[2], m[3]], ["Cue", "Door", "Open the door"]);
});

test("the panel's cue tab and the cue editor render with every string localized", async () => {
  const { SoundboardPanel } = await import("../scripts/panel.mjs");
  const { CueEditor } = await import("../scripts/cue-editor.mjs");
  const p = new SoundboardPanel();
  p.filterTargets.add("u1");
  const html = await p._renderHTML(await p._prepareContext());
  assert.ok(html.includes("ps-gobar") && html.includes("Aria") && html.includes("Deafened"));
  p.tab = "cues";
  const cueTab = await p._renderHTML(await p._prepareContext());
  assert.ok(cueTab.includes("ps-cue next") && cueTab.includes("→ Crypt"));
  const editor = await new CueEditor({ listId: "L1" })._renderHTML();
  assert.ok(editor.includes("Show the tavern") && editor.includes("Aria"));
  assert.deepEqual([...MISSING_KEYS], []);
});
