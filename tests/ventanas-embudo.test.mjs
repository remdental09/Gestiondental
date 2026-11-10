import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

test("todas las ventanas nacen del punto de origen y vuelven a él", () => {
  const dialog = read("components/ui/dialog.tsx"), css = read("app/globals.css");
  assert.match(dialog, /data-genie=""/);
  assert.match(dialog, /windowOriginOffset\(\)/);
  assert.doesNotMatch(dialog, /zoom-in-95/);
  assert.match(css, /@keyframes genie-open/);
  assert.match(css, /@keyframes genie-close/);
  assert.match(css, /prefers-reduced-motion/);
});
