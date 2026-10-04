// Not a test: renders the panel and editors with sample data into HTML files for README screenshots.
//   node tests/helpers/shots.mjs <outdir>
import { writeFileSync, readFileSync } from "node:fs";
import { pl, snd, boot } from "./foundry-stub.mjs";

const out = process.argv[2] ?? ".";
await boot();
const store = await import("../../scripts/store.mjs");
const engine = await import("../../scripts/engine.mjs");
const cues = await import("../../scripts/cues.mjs");

await store.upsertScape({ id: "A", name: "Tavern", group: "Town", color: "#b07a3a", icon: "fa-solid fa-beer-mug-empty", sceneId: "sc1",
  music: { mode: "track", soundUuid: snd("Music", "Tavern Theme").uuid, volume: 0.4 },
  ambience: [{ soundUuid: snd("Ambience", "Wind").uuid, volume: 0.3 }],
  scatter: [{ name: "Distant bell", sources: ["sfx/bell.ogg"], minDelay: 30, maxDelay: 90 }],
  pads: [{ name: "Door slam", icon: "fa-solid fa-door-open", sources: ["sfx/door.ogg"], duck: true },
    { name: "Laughter", icon: "fa-solid fa-face-laugh", sources: ["a.ogg", "b.ogg"] },
    { name: "Bard", icon: "fa-solid fa-guitar", loop: true, sources: ["c.ogg"] }] });
await store.upsertScape({ id: "B", name: "Market", group: "Town", color: "#c9a24a", icon: "fa-solid fa-city",
  music: { mode: "track", soundUuid: snd("Music", "Market Theme").uuid } });
await store.upsertScape({ id: "U", name: "Crypt", group: "Dungeon", color: "#5a5a8a", icon: "fa-solid fa-dungeon",
  filter: { preset: "cavern", intensity: 1 }, ambience: [{ soundUuid: snd("Ambience", "Drips").uuid }] });
await store.upsertScape({ id: "R", name: "Rain", group: "Layers", color: "#4a6ab0", icon: "fa-solid fa-cloud-rain", sticky: true,
  ambience: [{ soundUuid: snd("Ambience", "Rain").uuid }] });
await store.upsertScape({ id: "C", name: "Combat", group: "Combat", color: "#c8504a", icon: "fa-solid fa-khanda",
  music: { mode: "playlist", playlistUuid: pl("Battle").uuid } });
await cues.upsertCueList(cues.normCueList({ id: "L1", name: "Session 3: The Old Crypt", cues: [
  { name: "Arrive at the tavern", color: "#b07a3a", notes: "Read the box text, then GO",
    actions: [{ type: "scape", scapeId: "A", mode: "switch", fade: 4 }, { type: "macro", macroUuid: "Macro.m1" }, { type: "narrate", on: true }] },
  { name: "The stranger's story", actions: [{ type: "narrate", on: false }, { type: "filter", preset: "memory", on: true, targets: ["u1"] }] },
  { name: "Into the crypt", autoFollow: 2, actions: [{ type: "filter", preset: "memory", on: false }, { type: "scape", scapeId: "U", mode: "switch" }] },
  { name: "The door slams", color: "#c8504a", actions: [{ type: "pad", padKey: `A|${store.findScape("A").pads[0].id}` }, { type: "wait", seconds: 1.5 }, { type: "filter", preset: "deafened", on: true, targets: ["u2"] }] }
] }));
await cues.setRun({ listId: "L1", index: 1, last: 0 });
await engine.activate("Tavern");
await engine.activate("Rain", { additive: true });
engine.setFilter("memory", { targets: ["u1"] });
engine.narrate(true);

const { SoundboardPanel } = await import("../../scripts/panel.mjs");
const { CueEditor } = await import("../../scripts/cue-editor.mjs");
const { ScapeEditor } = await import("../../scripts/editor.mjs");
const css = readFileSync(new URL("../../styles/soundboard.css", import.meta.url), "utf8");
const page = (body, w, h, cls = "") => `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.2/css/all.min.css">
<style>body{margin:0;background:#000;font-family:Signika,system-ui,sans-serif}${css}</style></head>
<body><div class="ps-app ${cls}" style="width:${w}px;height:${h}px"><section class="window-content" style="height:100%">${body}</section></div></body></html>`;

const p = new SoundboardPanel();
p.filterTargets.add("u1");
writeFileSync(`${out}/panel.html`, page(await p._renderHTML(await p._prepareContext()), 880, 700));
p.tab = "cues";
writeFileSync(`${out}/cues.html`, page(await p._renderHTML(await p._prepareContext()), 880, 520));
writeFileSync(`${out}/cue-editor.html`, page(await new CueEditor({ listId: "L1" })._renderHTML(), 760, 820, "ps-editor"));
writeFileSync(`${out}/editor.html`, page(await new ScapeEditor({ scapeId: "A" })._renderHTML(), 760, 1080, "ps-editor"));
await engine.stopAll({ fadeMs: 0 });
engine.clearAllFilters();
engine.narrate(false);
process.exit(0);
