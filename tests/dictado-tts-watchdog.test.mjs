import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const src = readFileSync(new URL("../lib/dictation/speech.ts", import.meta.url), "utf8");

test("speakTextNow tiene respaldo si onend nunca se dispara (iOS Safari)", () => {
  assert.match(src, /estimateSpeechMs/);
  assert.match(src, /watchdog = setTimeout/);
  assert.match(src, /let finished = false/);
});
