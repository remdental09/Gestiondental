// Ejecuta la ruta pública /api/firmar (página y firma) contra una base simulada en memoria: el flujo real del paciente.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { signatureHash, sha256Hex, signLinkExpiry } from "../lib/consent-signature.ts";

const transpile = (path) => ts.transpileModule(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const sandboxGlobals = { crypto, TextEncoder, Response, Request, URL, URLSearchParams, Date, Uint8Array, btoa, JSON, Promise, Error, Intl };
const loadLib = (path) => { const exports = {}; runInNewContext(transpile(path), { exports, require: () => ({}), ...sandboxGlobals }); return exports; };
const consentLib = loadLib("lib/consent-signature.ts");
const verifyLib = loadLib("lib/document-verification.ts");

const TOKEN = "T".repeat(32);
const png = `data:image/png;base64,${"A".repeat(900)}`;
const contentHash = "c".repeat(64);

async function setup({ expired = false, docStatus = "emitido", content } = {}) {
  const tables = {
    consentSignatures: Object.fromEntries(["id", "documentId", "ownerId", "patientId", "status", "tokenHash", "tokenExpiresAt"].map(k => [k, k])),
    patientDocuments: Object.fromEntries(["id", "ownerId", "kind", "status", "patientId"].map(k => [k, k])),
    patients: Object.fromEntries(["id", "ownerId", "name", "rut"].map(k => [k, k])),
  };
  const rows = {
    consentSignatures: [{ id: 1, documentId: 10, ownerId: "o1", patientId: 5, status: "pendiente", tokenHash: await sha256Hex(TOKEN), tokenExpiresAt: expired ? "2020-01-01T00:00:00.000Z" : signLinkExpiry(new Date()), signerName: "", image: "", signatureHash: "" }],
    patientDocuments: [{ id: 10, ownerId: "o1", patientId: 5, kind: "consentimiento", status: docStatus, contentHash, revokedAt: "", createdBy: "p1", createdByName: "Dr. Prueba",
      content: JSON.stringify(content ?? { procedimiento: "Exodoncia <b>simple</b>", descripcion: "Se retira la pieza.", riesgos: "Dolor e inflamación.", alternativas: "Observación.", declaracion: "Declaro haber sido informado." }) }],
    patients: [{ id: 5, ownerId: "o1", name: "María José Pérez Soto", rut: "123456785" }],
  };
  const keyOf = table => Object.keys(tables).find(key => tables[key] === table);
  const flat = (c) => (Array.isArray(c) ? c.flatMap(flat) : [c]);
  const eq = (column, value) => ({ column, value });
  const and = (...conditions) => conditions;
  const match = (table, cond) => rows[keyOf(table)].filter(row => flat(cond).every(({ column, value }) => row[column] === value));
  const getDb = () => ({
    select: () => ({ from: table => ({ where: cond => ({ async limit(n) { return match(table, cond).slice(0, n); } }) }) }),
    update: table => ({ set: value => ({ where: cond => ({ async returning() { const hit = match(table, cond); hit.forEach(row => Object.assign(row, value)); return hit.map(row => ({ id: row.id })); } }) }) }),
  });
  const exports = {};
  runInNewContext(transpile("app/api/firmar/route.ts"), {
    exports,
    require: name => ({
      "drizzle-orm": { and, eq },
      "@/db": { getDb }, "@/db/schema": tables,
      "@/app/document-issuance-db": { ensureDocumentIssuanceColumns: async () => undefined },
      "@/app/consent-signature-db": { ensureConsentSignatureTable: async () => undefined },
      "@/app/clinician-profile-db": { loadProfile: async () => ({ clinicName: "Clínica Sonrisa" }) },
      "@/lib/consent-signature": consentLib, "@/lib/document-verification": verifyLib,
    })[name],
    ...sandboxGlobals,
  });
  return { ...exports, rows };
}

const get = (route, token = TOKEN) => route.GET(new Request(`https://speakdent.cl/api/firmar?t=${token}`));
const post = (route, body, headers = {}) => route.POST(new Request("https://speakdent.cl/api/firmar", { method: "POST", headers: { "Content-Type": "application/json", origin: "https://speakdent.cl", ...headers }, body: JSON.stringify({ t: TOKEN, accept: true, image: png, signerRole: "paciente", identity: "6785", ...body }) }));

test("GET: muestra el consentimiento con nombre abreviado, sin RUT, con el texto escapado y una política CSP con nonce", async () => {
  const route = await setup();
  const response = await get(route);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /Consentimiento informado/);
  assert.match(html, /Clínica Sonrisa/);
  assert.match(html, /Paciente: <strong>María S\.<\/strong>/);
  assert.doesNotMatch(html, /Pérez|123456785|6785/);
  assert.match(html, /Exodoncia &lt;b&gt;simple&lt;\/b&gt;/, "el contenido se escapa");
  assert.doesNotMatch(html, /<b>simple/);
  const csp = response.headers.get("Content-Security-Policy");
  const nonce = /script-src 'nonce-([^']+)'/.exec(csp)?.[1];
  assert.ok(nonce);
  assert.ok(html.includes(`<script nonce="${nonce}">`));
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  // El script del paciente es sintácticamente válido.
  const script = /<script nonce="[^"]+">([\s\S]*?)<\/script>/.exec(html)[1];
  assert.doesNotThrow(() => new Function(script));
});

test("GET: enlace inexistente, vencido o de un documento no emitido responde 404 sin mostrar nada", async () => {
  for (const [label, route, token] of [["otro código", await setup(), "X".repeat(32)], ["código corto", await setup(), "abc"], ["vencido", await setup({ expired: true }), TOKEN], ["borrador", await setup({ docStatus: "borrador" }), TOKEN], ["anulado", await setup({ docStatus: "anulado" }), TOKEN]]) {
    const response = await get(route, token);
    assert.equal(response.status, 404, label);
    assert.doesNotMatch(await response.text(), /Exodoncia|María/, label);
  }
});

test("POST: firma válida registra la huella, invalida el enlace y no se puede usar dos veces", async () => {
  const route = await setup();
  const response = await post(route, {});
  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.ok, true);
  assert.match(data.code, /^[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}$/);
  const row = route.rows.consentSignatures[0];
  assert.equal(row.status, "firmado");
  assert.equal(row.tokenHash, null);
  assert.equal(row.signerName, "María José Pérez Soto");
  assert.equal(row.method, "enlace");
  assert.equal(row.image, png);
  assert.equal(row.signatureHash, await signatureHash({ documentHash: contentHash, image: png, signedAt: row.signedAt, signerName: row.signerName, signerRole: "paciente", signerRelation: "", method: "enlace" }));
  const again = await post(route, {});
  assert.equal(again.status, 404, "el enlace ya no existe");
  assert.equal((await get(route)).status, 404);
});

test("POST: identidad incorrecta, firma inválida o sin aceptar se rechazan y el enlace sigue vigente", async () => {
  const route = await setup();
  for (const [label, body, expected] of [["identidad", { identity: "0000" }, /no coinciden/], ["sin identidad", { identity: "" }, /no coinciden/], ["imagen", { image: "data:image/png;base64,AAA" }, /firma no es válida/], ["sin aceptar", { accept: false }, /declaración/]]) {
    const response = await post(route, body);
    assert.equal(response.status, 400, label);
    assert.match((await response.json()).error, expected, label);
  }
  assert.equal(route.rows.consentSignatures[0].status, "pendiente");
  assert.equal((await get(route)).status, 200);
});

test("POST: el representante legal debe indicar nombre y relación, y la firma queda a su nombre", async () => {
  const route = await setup();
  const missing = await post(route, { signerRole: "representante", signerName: "Ana Soto", signerRelation: "" });
  assert.equal(missing.status, 400);
  const ok = await post(route, { signerRole: "representante", signerName: "  Ana   Soto ", signerRelation: "madre" });
  assert.equal(ok.status, 200);
  const row = route.rows.consentSignatures[0];
  assert.deepEqual([row.signerName, row.signerRole, row.signerRelation], ["Ana Soto", "representante", "madre"]);
});

test("POST: rechaza otro origen y el documento anulado después de enviar el enlace", async () => {
  const route = await setup();
  assert.equal((await post(route, {}, { origin: "https://otro.example" })).status, 403);
  route.rows.patientDocuments[0].status = "anulado";
  assert.equal((await post(route, {})).status, 404);
  assert.equal(route.rows.consentSignatures[0].status, "pendiente");
});
