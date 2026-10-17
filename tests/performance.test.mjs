// Network and CPU care: preload over the socket, heavy-file check, the soundscape cache,
// ducking without endless re-fades, combat automation on one GM only.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { LOG, snd, boot, sleep } from "./helpers/foundry-stub.mjs";
import { heaviness, describeHeavy, HEAVY_BYTES } from "../scripts/audio-check.mjs";

await boot();
const store = await import("../scripts/store.mjs");
const engine = await import("../scripts/engine.mjs");
const cues = await import("../scripts/cues.mjs");

after(async () => { await engine.stopAll({ fadeMs: 0 }); engine.narrate(false); });

await store.upsertScape({ id: "A", name: "Tavern", music: { mode: "track", soundUuid: snd("Music", "Tavern Theme").uuid },
  pads: [{ id: "p1", name: "Door", sources: ["sfx/door.ogg"] }],
  scatter: [{ id: "s1", name: "Crows", sources: ["sfx/crow.ogg", "sfx/door.ogg"] }] });

const preloadMsgs = () => LOG.filter(l => l.socket === "preload").map(l => l.msg);
const local = () => LOG.filter(l => l.localPreload).map(l => l.localPreload);

test("heaviness: uncompressed formats and big files are flagged, normal OGG is not", () => {
  assert.equal(heaviness("music/Rain.wav"), "uncompressed");
  assert.equal(heaviness("music/Rain.FLAC?x=1"), "uncompressed");
  assert.equal(heaviness("music/Rain.ogg", HEAVY_BYTES + 1), "large");
  assert.equal(heaviness("music/Rain.ogg", 3 * 1048576), null);
  assert.equal(heaviness("music/Rain.ogg", null), null);
  assert.equal(describeHeavy({ path: "a/My%20Song.mp3", bytes: 20 * 1048576 }), "My Song.mp3 (20 MB)");
});

test("preload: one socket message for everyone, loaded locally once, duplicates skipped", async () => {
  LOG.length = 0;
  assert.equal(engine.preloadPaths(["x.ogg", "y.ogg", "x.ogg", ""]), 2);
  assert.equal(engine.preloadPaths(["x.ogg"]), 1);
  await sleep(10);
  assert.equal(preloadMsgs().length, 2);
  assert.deepEqual(preloadMsgs()[0].paths, ["x.ogg", "y.ogg"]);
  assert.equal(preloadMsgs()[0].to, null);
  assert.deepEqual(local(), ["x.ogg", "y.ogg"], "this client loads each file once");
});

test("preload: a player loads only what a GM asks for, and only if addressed", async () => {
  const handler = game.socket.handler;
  LOG.length = 0;
  handler({ action: "preload", from: "u1", paths: ["evil.ogg"] });                   // not a GM
  handler({ action: "preload", from: "gm", paths: ["other.ogg"], to: ["u1"] });       // not me
  handler({ action: "preload", from: "gm", paths: ["mine.ogg", 42], to: ["gm"] });
  await sleep(10);
  assert.deepEqual(local(), ["mine.ogg"]);
});

test("a joining player is sent the active pads and scatter only", async () => {
  await engine.activate("Tavern");
  LOG.length = 0;
  engine.preloadForUser("u1");
  const [m] = preloadMsgs();
  assert.deepEqual(m.to, ["u1"]);
  assert.deepEqual(m.paths.sort(), ["sfx/crow.ogg", "sfx/door.ogg"]);
});

test("cuePaths: switch scapes, pads and played files; not layers being turned off", () => {
  const cue = cues.normCue({ actions: [
    { type: "scape", scapeId: "A", mode: "switch" },
    { type: "scape", scapeId: "A", mode: "layerOff" },
    { type: "pad", scapeId: "A", padId: "p1" },
    { type: "play", src: "sfx/bell.ogg" }
  ] });
  const paths = cues.cuePaths(cue);
  assert.ok(paths.includes(snd("Music", "Tavern Theme").path));
  assert.ok(paths.includes("sfx/door.ogg") && paths.includes("sfx/bell.ogg"));
});

test("soundscape cache: reads are copies, and a save is seen at once", async () => {
  const a = store.findScape("A");
  a.name = "changed in place";
  assert.equal(store.findScape("A").name, "Tavern", "changing a returned scape doesn't touch the cache");
  await store.upsertScape({ ...store.findScape("A"), name: "Inn" });
  assert.equal(store.findScape("Inn")?.id, "A");
  await store.upsertScape({ ...store.findScape("A"), name: "Tavern" });
});

test("narrate ducks a playing sound once and doesn't re-fade it every second", async () => {
  const ps = snd("Music", "Tavern Theme");
  const fades = [];
  ps.playing = true;
  ps.volume = 0.5;
  ps.sound = { playing: true, volume: 0.5, fade(v) { fades.push(v); this.volume = v; } };
  try {
    engine.narrate(true);
    assert.equal(fades.length, 1);
    assert.ok(Math.abs(fades[0] - 0.5 * 0.3) < 1e-9);
    await sleep(1150);                       // one tick of the 1 s check
    assert.equal(fades.length, 1, "nothing changed, so no new fade");
    ps.volume = 0.8;                         // the GM moves the track's volume
    await sleep(1100);
    assert.equal(fades.length, 2);
    assert.ok(Math.abs(fades[1] - 0.8 * 0.3) < 1e-9);
    engine.narrate(false);
    assert.equal(fades.at(-1), 0.8, "back to the track's own volume");
  } finally { delete ps.sound; ps.playing = false; ps.volume = 0.5; }
});

test("combat automation runs on the active GM only", async () => {
  await game.settings.set("planar-soundboard", "combatAuto", true);
  const before = game.users.activeGM;
  game.users.activeGM = { id: "other-gm", isSelf: false };
  try {
    LOG.length = 0;
    engine.onCombatStart();
    await sleep(10);
    assert.equal(store.getState().combatReturn, null, "a second GM tab does nothing");
  } finally { game.users.activeGM = before; }
});
