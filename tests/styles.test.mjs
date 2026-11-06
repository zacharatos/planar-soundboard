import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Other modules (Planar Store) use the same ps- prefix. An unscoped .ps-* rule here
// can be beaten by theirs, so every rule must sit under the window class .ps-app.
test("every .ps-* rule is scoped under .ps-app", () => {
  const css = readFileSync(new URL("../styles/soundboard.css", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/@keyframes[^{]*\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, "");
  const preludes = [...css.matchAll(/([^{}]+)\{[^}]*\}/g)].map(m => m[1]);
  const loose = preludes.flatMap(p => p.split(",")).map(s => s.trim())
    .filter(s => s.startsWith(".ps-") && !s.startsWith(".ps-app"));
  assert.deepEqual(loose, []);
});
