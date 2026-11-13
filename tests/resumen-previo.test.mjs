import test from "node:test";
import assert from "node:assert/strict";
import { buildPatientBrief, fdiLabel } from "../lib/patient-brief.ts";
import { emptyAnamnesis } from "../lib/anamnesis.ts";

const today = "2026-11-13";
const base = { notes: [], budgets: [], payments: [], today };
const anamnesis = (patch = {}) => ({ ...emptyAnamnesis(), ...patch });

test("FDI con punto", () => {
  assert.equal(fdiLabel(36), "3.6");
  assert.equal(fdiLabel(18), "1.8");
});

test("sin anamnesis: queda «sin registrar», no «niega»", () => {
  const brief = buildPatientBrief({ ...base, anamnesis: null });
  assert.equal(brief.anamnesisRecorded, false);
  assert.deepEqual(brief.alerts, []);
  assert.deepEqual(brief.gaps, ["Anamnesis sin registrar"]);
});

test("alertas desde la anamnesis: alergia, anticoagulantes y enfermedades de riesgo", () => {
  const brief = buildPatientBrief({ ...base, anamnesis: anamnesis({ allergies: "Penicilina", anticoagulants: "si", conditions: ["hipertension", "diabetes"], medications: "Losartán" }) });
  assert.ok(brief.alerts.includes("Alergias: Penicilina"));
  assert.ok(brief.alerts.includes("Usa anticoagulantes / antiagregantes"));
  assert.ok(brief.alerts.includes("Diabetes"));
  assert.ok(brief.alerts.includes("Hipertensión arterial"));
  assert.deepEqual(brief.gaps, []);
  assert.ok(brief.background.some(([k, v]) => k === "Medicamentos" && v === "Losartán"));
});

test("«niega alergias» no es alerta y lo no preguntado figura como dato faltante", () => {
  const brief = buildPatientBrief({ ...base, anamnesis: anamnesis({ allergies: "Niega", conditions: ["asma"] }) });
  assert.ok(!brief.alerts.some(a => a.startsWith("Alergias")));
  assert.deepEqual(brief.gaps, ["Medicamentos", "Anticoagulantes"]);
});

test("alergia del campo antiguo de la ficha solo si no hay anamnesis y no es «Sin registrar»", () => {
  assert.deepEqual(buildPatientBrief({ ...base, anamnesis: null, legacyAllergies: "Sin registrar" }).alerts, []);
  assert.deepEqual(buildPatientBrief({ ...base, anamnesis: null, legacyAllergies: "Látex" }).alerts, ["Alergias (ficha): Látex"]);
  assert.deepEqual(buildPatientBrief({ ...base, anamnesis: anamnesis({ observations: "x" }), legacyAllergies: "Látex" }).alerts, []);
});

test("última visita: la más reciente vigente, sin anuladas, con días transcurridos", () => {
  const notes = [
    { id: 1, clinicalDate: "2026-09-01", date: "01-09-2026", title: "Control", body: "Control de rutina." },
    { id: 3, clinicalDate: "2026-11-03", date: "03-11-2026", title: "Anulada", body: "No va.", status: "anulada" },
    { id: 2, clinicalDate: "2026-10-24", date: "24-10-2026", title: "Endodoncia pieza 19", body: "Se  hizo\n apertura   cameral." },
  ];
  const brief = buildPatientBrief({ ...base, anamnesis: null, notes });
  assert.equal(brief.lastVisit.title, "Endodoncia pieza 19");
  assert.equal(brief.lastVisit.excerpt, "Se hizo apertura cameral.");
  assert.equal(brief.lastVisit.daysAgo, 20);
  assert.equal(buildPatientBrief({ ...base, anamnesis: null }).lastVisit, null);
});

test("extracto largo se corta sin partir palabras", () => {
  const body = "palabra ".repeat(80);
  const { excerpt } = buildPatientBrief({ ...base, anamnesis: null, notes: [{ id: 1, clinicalDate: "2026-11-01", title: "t", body }] }).lastVisit;
  assert.ok(excerpt.length <= 221 && excerpt.endsWith("…") && !excerpt.includes("palabr…"));
});

test("diagnósticos recientes: sin repetidos, más nuevos primero, pieza en FDI con punto", () => {
  const notes = [
    { id: 1, clinicalDate: "2026-09-01", title: "a", body: "", diagnoses: [{ title: "Caries de dentina", tooth: 14 }] },
    { id: 2, clinicalDate: "2026-10-01", title: "b", body: "", diagnoses: [{ title: "Pulpitis irreversible sintomática", tooth: 46 }, { title: "Caries de dentina", tooth: 14 }] },
  ];
  assert.deepEqual(buildPatientBrief({ ...base, anamnesis: null, notes }).recentDiagnoses, ["Pulpitis irreversible sintomática (pieza 4.6)", "Caries de dentina (pieza 1.4)"]);
});

test("tratamientos pendientes y saldo: solo planes principales, lo hecho no cuenta", () => {
  const budgets = [
    { id: 1, title: "Plan", isAlternative: false, items: [
      { label: "Endodoncia", amount: 150000, teeth: [46], doneOn: "2026-10-24" },
      { label: "Corona zirconia", amount: 480000, teeth: [46] },
      { label: "Limpieza", amount: 30000 },
    ] },
    { id: 2, title: "Alternativa", isAlternative: true, items: [{ label: "Implante", amount: 900000, teeth: [46] }] },
  ];
  const brief = buildPatientBrief({ ...base, anamnesis: null, budgets, payments: [{ amount: 100000 }] });
  assert.deepEqual(brief.pendingTreatments, { items: ["Corona zirconia (4.6)", "Limpieza"], more: 0 });
  assert.equal(brief.owed, 560000);
});

test("pendientes: tope de 6 y el resto se cuenta; sin presupuesto no hay saldo", () => {
  const items = Array.from({ length: 9 }, (_, i) => ({ label: `Prestación ${i + 1}`, amount: 1000 }));
  const brief = buildPatientBrief({ ...base, anamnesis: null, budgets: [{ id: 1, title: "P", isAlternative: false, items }] });
  assert.equal(brief.pendingTreatments.items.length, 6);
  assert.equal(brief.pendingTreatments.more, 3);
  assert.equal(buildPatientBrief({ ...base, anamnesis: null, payments: [{ amount: 5000 }] }).owed, 0);
  assert.equal(buildPatientBrief({ ...base, anamnesis: null, budgets: [{ id: 1, title: "P", isAlternative: false, items }], payments: [{ amount: 99999 }] }).owed, 0);
});
