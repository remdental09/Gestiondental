import test from "node:test";
import assert from "node:assert/strict";
import { missingData } from "../lib/dictation/proposal.ts";

const base = { evolution: { title: "Evolución", body: "Motivo y relato\nControl." }, odontogram: [], budget: [], perio: [], clarifications: [] };

test("Falta prioriza valores, plan y hallazgos, y es solo una lista (no bloquea)", () => {
  assert.deepEqual(missingData(base).map((item) => item.split(":")[0]), ["Valores", "Plan", "Hallazgos", "Próxima cita"]);
});

test("Falta desaparece cuando el dictado trae dinero, plan, hallazgo y cita", () => {
  const full = { ...base, budget: [{ label: "Corona 3.6", amount: 450000 }], payments: [{ amount: 100000 }], odontogram: [{ tooth: 36, status: "Fractura" }], appointments: [{ date: "2026-11-20" }] };
  assert.deepEqual(missingData(full), []);
});
