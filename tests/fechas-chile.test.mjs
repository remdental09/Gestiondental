import test from "node:test";
import assert from "node:assert/strict";
import { chileDay } from "../lib/chile-day.ts";
import { eventDate } from "../lib/odontogram-timeline.ts";

test("un registro a las 21:30 de Chile sigue siendo ese día, no el siguiente (UTC)", () => {
  assert.equal(chileDay("2026-11-10T00:33:00.000Z"), "2026-11-09");
  assert.equal(chileDay("2026-11-09T15:00:00.000Z"), "2026-11-09");
  assert.equal(chileDay("2026-07-10T03:30:00.000Z"), "2026-07-09", "invierno, UTC-4");
  assert.equal(chileDay("2026-11-09"), "2026-11-09");
  assert.equal(eventDate({ recordedAt: "2026-11-10T00:33:00.000Z" }), "2026-11-09");
  assert.equal(eventDate({ recordedAt: "2026-11-10T00:33:00.000Z", clinicalDate: "2026-11-08" }), "2026-11-08");
});
