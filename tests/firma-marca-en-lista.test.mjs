import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { signatureListMark } from "../lib/consent-signature.ts";

test("un consentimiento firmado queda consignado como firmado y autorizado por el paciente", () => {
  assert.deepEqual(signatureListMark("consentimiento", "emitido", { status: "firmado", signerRole: "paciente" }), { tone: "firmado", text: "Firmado y autorizado por el paciente" });
  assert.match(signatureListMark("consentimiento", "emitido", { status: "firmado", signerRole: "representante" }).text, /representante legal/);
});

test("un consentimiento emitido sin firma se marca pendiente; el borrador y otros documentos no llevan marca", () => {
  assert.equal(signatureListMark("consentimiento", "emitido", null).tone, "pendiente");
  assert.match(signatureListMark("consentimiento", "emitido", null).text, /Falta la firma/);
  assert.match(signatureListMark("consentimiento", "emitido", { status: "pendiente", signerRole: "", linkActive: true }).text, /Esperando la firma/);
  assert.equal(signatureListMark("consentimiento", "borrador", null), null);
  for (const kind of ["receta", "orden", "certificado", "receta_magistral"]) assert.equal(signatureListMark(kind, "emitido", null), null, kind);
});

test("la lista de documentos guardados muestra la marca", () => {
  const panel = readFileSync(new URL("../components/documentation-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /signatureListMark\(document\.kind, document\.status, document\.signature\)/);
  assert.match(panel, /data-testid=\{`document-signature-\$\{mark\.tone\}`\}/);
});
