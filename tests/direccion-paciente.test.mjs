import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { normalizeAddress, formatAddress, hasAddress, emptyAddress } from "../lib/patient-address.ts";

test("la dirección se normaliza y el país por defecto es Chile", () => {
  assert.deepEqual(normalizeAddress({ street: "  Av.  Providencia   1234 ", commune: " Providencia " }), { street: "Av. Providencia 1234", commune: "Providencia", country: "Chile" });
  assert.deepEqual(normalizeAddress(null), emptyAddress());
  assert.equal(normalizeAddress({ street: "x".repeat(500) }).street.length, 160);
});

test("formato legible y país solo no cuenta como dirección", () => {
  assert.equal(formatAddress({ street: "Los Leones 100", commune: "Ñuñoa", country: "Chile" }), "Los Leones 100, Ñuñoa, Chile");
  assert.equal(hasAddress(emptyAddress()), false);
  assert.equal(formatAddress(emptyAddress()), "");
});

test("la API y la ficha usan calle, comuna y país", () => {
  const route = readFileSync(new URL("../app/api/clinical/route.ts", import.meta.url), "utf8");
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(route, /loadAddresses\(ownerId\)/);
  assert.match(route, /saveAddress\(ownerId, p\.id, input\.address\)/);
  for (const id of ["patient-street", "patient-commune", "patient-country"]) assert.equal(page.split(id).length - 1, 2, id);
  assert.match(page, /label="Dirección"/);
});
