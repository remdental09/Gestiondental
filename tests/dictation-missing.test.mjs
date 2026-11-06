import test from "node:test";
import assert from "node:assert/strict";
import { missingData } from "../lib/dictation/proposal.ts";

const base = { evolution: { title: "Evolución", body: "Motivo y relato\nControl." }, odontogram: [], budget: [], perio: [], clarifications: [] };

test("Falta prioriza plan y hallazgos (sin dinero), y es solo una lista (no bloquea)", () => {
  assert.deepEqual(missingData(base).map((item) => item.split(":")[0]), ["Plan", "Hallazgos", "Próxima cita"]);
});

test("Falta desaparece cuando el dictado trae plan, hallazgo y cita", () => {
  const full = { ...base, procedures: [{ label: "Corona 3.6" }], odontogram: [{ tooth: 36, status: "Fractura" }], appointments: [{ date: "2026-11-20" }] };
  assert.deepEqual(missingData(full), []);
});
