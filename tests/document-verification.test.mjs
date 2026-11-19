import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { documentHash, isVerifyToken, newVerifyToken, shortCode, verificationState, verificationUrl } from "../lib/document-verification.ts";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const doc = { ownerId: "o1", patientId: 7, kind: "receta", title: "Receta", content: '{"prescripcion":"Ibuprofeno 400 mg"}', createdBy: "p1", createdByName: "Dr. Prueba", issuedAt: "2026-11-19T03:00:00.000Z" };

test("el código del QR es largo, aleatorio y con formato válido", () => {
  const tokens = new Set(Array.from({ length: 200 }, newVerifyToken));
  assert.equal(tokens.size, 200);
  for (const token of tokens) assert.equal(isVerifyToken(token), true);
  assert.equal(isVerifyToken("123"), false);
  assert.equal(isVerifyToken("a".repeat(31) + "!"), false);
  assert.equal(isVerifyToken(undefined), false);
});

test("la huella cambia si cambia cualquier dato emitido y es estable si no", async () => {
  const base = await documentHash(doc);
  assert.match(base, /^[0-9a-f]{64}$/);
  assert.equal(await documentHash({ ...doc }), base);
  for (const change of [{ content: '{"prescripcion":"Ibuprofeno 800 mg"}' }, { patientId: 8 }, { createdByName: "Otro" }, { issuedAt: "2026-11-19T03:00:01.000Z" }, { kind: "certificado" }, { ownerId: "o2" }]) {
    assert.notEqual(await documentHash({ ...doc, ...change }), base);
  }
  assert.match(shortCode(base), /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
});

test("el estado público distingue vigente, anulado, reemplazado, alterado y no emitido", () => {
  const issued = { status: "emitido", revokedAt: "", revokedReason: "", contentHash: "abc" };
  assert.equal(verificationState(issued, "abc"), "valido");
  assert.equal(verificationState(issued, "xyz"), "alterado");
  assert.equal(verificationState({ ...issued, status: "anulado", revokedAt: "2026-11-20", revokedReason: "anulado" }, "abc"), "anulado");
  assert.equal(verificationState({ ...issued, status: "reemplazado", revokedAt: "2026-11-20", revokedReason: "reemplazado" }, "abc"), "reemplazado");
  assert.equal(verificationState({ ...issued, status: "borrador", contentHash: "" }, "abc"), "no-emitido");
  assert.equal(verificationUrl("https://speakdent.cl/", "T"), "https://speakdent.cl/api/verificar?t=T");
});

test("la página pública no expone datos clínicos ni del paciente", () => {
  const route = read("app/api/verificar/route.ts");
  assert.doesNotMatch(route, /import[^\n]*\bpatients\b/);
  const rows = [...route.matchAll(/row\("[^"]+", ([^)]*)\)/g)].map(match => match[1]).join(" ");
  assert.doesNotMatch(rows, /content\b|patientId|rut|birth/i);
  assert.match(route, /isVerifyToken\(token\)/);
  assert.match(route, /X-Robots-Tag/);
  assert.match(route, /no-store/);
});

test("emitir y anular solo operan sobre documentos del propietario y nunca borran", () => {
  for (const path of ["app/api/documentos/emitir/route.ts", "app/api/documentos/anular/route.ts"]) {
    const route = read(path);
    assert.match(route, /eq\(patientDocuments\.ownerId, user\.userId\)/);
    assert.match(route, /request\.headers\.get\("origin"\)/);
    assert.doesNotMatch(route, /\.delete\(/);
  }
  assert.match(read("app/api/documentos/emitir/route.ts"), /eq\(patientDocuments\.status, "borrador"\)/);
});

test("el worker deja pública solo la verificación por GET/HEAD", () => {
  const worker = read("worker.ts");
  assert.match(worker, /path === "\/api\/verificar" && \(request\.method === "GET" \|\| request\.method === "HEAD"\)/);
  assert.doesNotMatch(worker, /\/api\/documentos[^"']*"\s*&&\s*\(request\.method/);
});

test("la migración agrega las columnas de emisión sin tocar datos", () => {
  const sql = read("drizzle/0010_qr_verificacion.sql");
  for (const column of ["verify_token", "content_hash", "issued_at", "revoked_at", "revoked_reason", "replaces_id"]) assert.match(sql, new RegExp(column));
  assert.doesNotMatch(sql, /DROP|DELETE|UPDATE/i);
  assert.match(sql, /CREATE UNIQUE INDEX `patient_documents_verify_token_idx`/);
});
