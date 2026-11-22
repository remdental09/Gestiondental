import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const worker = readFileSync(new URL("../worker.ts", import.meta.url), "utf8");

test("en workers.dev, el ingreso con Google y la conexión de Drive van a speakdent.cl", () => {
  assert.match(worker, /const CANONICAL_ORIGIN = "https:\/\/speakdent\.cl";/);
  assert.match(worker, /new Set\(\["\/", LOGIN_PATH, "\/api\/drive\/connect"\]\)/);
  assert.match(worker, /hostname\.endsWith\("\.workers\.dev"\)/);
  assert.match(worker, /Response\.redirect\(CANONICAL_ORIGIN \+ url\.pathname \+ url\.search, 302\)/);
});

test("la redirección va antes de las rutas públicas y del inicio de sesión", () => {
  const handler = worker.slice(worker.indexOf("defaultHandler: {"));
  const redirect = handler.indexOf("canonicalGoogleRedirect(request)");
  assert.ok(redirect > 0);
  assert.ok(redirect < handler.indexOf("path === LOGIN_PATH"));
  assert.ok(redirect < handler.indexOf('path === "/api/confirmar"'));
});

test("las rutas MCP, OAuth y los enlaces públicos de pacientes no se redirigen", () => {
  const set = worker.match(/CANONICAL_PATHS = new Set\(\[([^\]]*)\]\)/)[1];
  for (const p of ["/mcp", "/oauth", "/authorize", "/api/confirmar", "/api/verificar", "/api/firmar"]) assert.ok(!set.includes(`"${p}`), p);
});
