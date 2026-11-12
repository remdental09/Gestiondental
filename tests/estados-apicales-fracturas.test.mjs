import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { ALL_TOOTH_STATUSES, APICAL_STATUSES, FRACTURE_STATUSES, isLesionStatus } from "../lib/tooth-status.ts";

test("el estado general incluye lesiones apicales y fracturas", () => {
  for (const s of [...APICAL_STATUSES, ...FRACTURE_STATUSES]) assert.ok(ALL_TOOTH_STATUSES.includes(s) && isLesionStatus(s), s);
  assert.ok(ALL_TOOTH_STATUSES.includes("Corona") && !isLesionStatus("Corona"));
  assert.equal(new Set(ALL_TOOTH_STATUSES).size, ALL_TOOTH_STATUSES.length);
});

test("servidor, MCP y selector usan la misma lista", () => {
  for (const f of ["../app/api/clinical/route.ts", "../app/mcp/route.ts"]) assert.match(readFileSync(new URL(f, import.meta.url), "utf8"), /ALL_TOOTH_STATUSES/);
  const odo = readFileSync(new URL("../components/odontogram.tsx", import.meta.url), "utf8");
  assert.match(odo, /label="Lesiones apicales"/);
  assert.match(odo, /label="Fracturas"/);
});
