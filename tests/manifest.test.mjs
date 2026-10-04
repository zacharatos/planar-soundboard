import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { MODULE_ID } from "../scripts/store.mjs";
import { I18N } from "../scripts/i18n.mjs";

const file = p => new URL(`../${p}`, import.meta.url);
const manifest = JSON.parse(readFileSync(file("module.json"), "utf8"));

test("manifest has the fields Foundry requires", () => {
  for (const k of ["id", "title", "description", "version", "compatibility"]) assert.ok(manifest[k], k);
  assert.match(manifest.id, /^[a-z0-9-]+$/);
  assert.equal(manifest.id, MODULE_ID, "store.mjs and module.json must agree");
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/);
  assert.ok(manifest.compatibility.minimum && manifest.compatibility.verified);
  assert.equal(manifest.socket, true, "the module talks to players over its socket");
});

test("every referenced file exists", () => {
  for (const p of [...manifest.esmodules, ...manifest.styles, ...manifest.languages.map(l => l.path)]) {
    assert.ok(existsSync(file(p)), p);
  }
});

const flatten = (obj, prefix = "") => Object.entries(obj).flatMap(([k, v]) =>
  v && typeof v === "object" ? flatten(v, `${prefix}${k}.`) : [`${prefix}${k}`]);
const langs = Object.fromEntries(manifest.languages.map(l => [l.lang, JSON.parse(readFileSync(file(l.path), "utf8"))]));
const get = (o, path) => path.split(".").reduce((x, k) => x?.[k], o);

test("all languages define exactly the same keys as English", () => {
  const en = flatten(langs.en).sort();
  for (const [code, data] of Object.entries(langs)) assert.deepEqual(flatten(data).sort(), en, `${code} differs from en`);
});

test("placeholders match between languages", () => {
  const holders = s => (s.match(/\{\w+\}/g) ?? []).sort().join();
  for (const k of flatten(langs.en)) {
    for (const [code, data] of Object.entries(langs)) assert.equal(holders(get(data, k)), holders(get(langs.en, k)), `${code}: ${k}`);
  }
});

const sources = readdirSync(file("scripts")).filter(f => f.endsWith(".mjs"))
  .map(f => readFileSync(file(`scripts/${f}`), "utf8")).join("\n");
const en = langs.en[I18N];

test("every localization key used in the code exists", () => {
  const namespaces = Object.keys(en).join("|");
  // "Panel.Narrate", t("Title"), key("Settings.x.Name"), "PLANAR_SOUNDBOARD.Editor.WindowTitle"
  const literal = [...sources.matchAll(new RegExp(`"(?:${I18N}\\.)?((?:${namespaces})(?:\\.[\\w]+)*)"`, "g"))].map(m => m[1]);
  assert.ok(literal.length > 150, `found ${literal.length} keys`);
  for (const k of literal) assert.notEqual(get(en, k), undefined, `missing key ${k}`);
  // `Filters.${id}.Label` and friends: the prefix must be a group in en.json
  const prefixes = [...sources.matchAll(/`([A-Z][\w.]*?)\.\$\{/g)].map(m => m[1]);
  for (const p of prefixes) assert.equal(typeof get(en, p), "object", `missing group ${p}`);
});

test("every filter preset, action type and keybinding has its strings", async () => {
  const { PRESETS } = await import("../scripts/fxgraph.mjs");
  for (const id of Object.keys(PRESETS)) {
    assert.ok(en.Filters[id]?.Label && en.Filters[id]?.Hint, id);
  }
  const actions = [...sources.matchAll(/^\s{2}(\w+):\s+\{ icon:/gm)].map(m => m[1]);
  for (const a of actions) assert.ok(en.Cues.Actions[a] || en.Channels[a], a);
  for (let i = 1; i <= 9; i++) assert.ok(en.Keys[`pad${i}`]);
});

test("no hard-coded notifications", () => {
  assert.ok(!/ui\.notifications\.(info|warn|error)\(\s*[`"]/.test(sources), "use info()/warn()/error() from i18n.mjs");
});
