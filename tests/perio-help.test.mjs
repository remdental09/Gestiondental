import test from "node:test";
import assert from "node:assert/strict";
import { PERIO_HELP } from "../lib/perio-help.ts";

test("cada índice periodontal tiene instrucciones y escala", () => {
  for (const topic of ["epb", "gingival", "mobility", "furcation", "classification"]) {
    const help = PERIO_HELP[topic];
    assert.ok(help.title && help.how.length >= 3 && help.scale?.length, topic);
  }
  assert.ok(PERIO_HELP.epb.scale.some(line => line.startsWith("3 ·") && line.includes("3,5 a 5,5")));
});
