import test from "node:test";
import assert from "node:assert/strict";
import { toothPhotoFor } from "../lib/tooth-photos.ts";

test("una pieza con capas v3 ofrece la vista palatina aunque la lesión no esté en P", () => {
  const photo = toothPhotoFor({ fdi: 16, caries: true, cariesSurfaces: [{ surface: "V", depth: "dentina_superficial" }] });
  assert.equal(photo?.hasPalatal, true);
});
