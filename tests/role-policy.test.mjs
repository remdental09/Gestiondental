import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { agendaActionDenied, apiDenied, clinicalActionDenied, filterClinicalLoad, navAllowed, statusDenied, tabAllowed, firstTab } from "../lib/role-policy.ts";
import { canChangeBudget, checkInvite, isSupportRole, isTeamRole, ROLE_LABEL } from "../lib/clinic-team.ts";

test("titular, administrador y dentista: sin restricciones nuevas", () => {
  for (const role of ["titular", "admin", "dentista", undefined, null]) {
    assert.equal(apiDenied(role, "POST", "/api/dictation/structure"), null);
    assert.equal(clinicalActionDenied(role, "addNote"), null);
    assert.equal(agendaActionDenied(role, "horario"), null);
    assert.equal(statusDenied(role, "cancelada"), null);
  }
});

test("Recepción: agenda, pacientes, presupuestos y pagos sí; lo clínico no", () => {
  for (const action of ["createPatient", "updatePatient", "addBudget", "updateBudget", "setBudgetStatus", "addPayment", "addAppointment", "updateAppointment", "deleteAppointment"]) assert.equal(clinicalActionDenied("recepcion", action), null, action);
  for (const action of ["addNote", "updateEvolution", "annulEvolution", "deleteEvolution", "setEvolutionDiagnoses", "savePerio", "setToothStatus", "applyToothDictation", "setBudgetItemDone", "setBudgetItemStatus", "importDriveRecords", undefined, "inventada"]) assert.ok(clinicalActionDenied("recepcion", action), String(action));
  for (const [m, p] of [["GET", "/api/anamnesis"], ["GET", "/api/images/3"], ["POST", "/api/images"], ["GET", "/api/documentos"], ["POST", "/api/documentos/emitir"], ["GET", "/api/endodontics"], ["GET", "/api/alertas"], ["GET", "/api/clinical/export"], ["POST", "/api/text-correction"], ["PUT", "/api/aranceles"], ["POST", "/api/box"], ["PUT", "/api/preferencias"], ["GET", "/api/desarrollador"]]) assert.ok(apiDenied("recepcion", m, p), `${m} ${p}`);
  for (const [m, p] of [["GET", "/api/clinical"], ["POST", "/api/clinical"], ["POST", "/api/agenda-box"], ["PUT", "/api/asistencia"], ["GET", "/api/dashboard"], ["GET", "/api/presupuesto/pdf"], ["POST", "/api/presupuesto/enviar"], ["POST", "/api/controles"], ["POST", "/api/appointment-mail"], ["GET", "/api/lista-espera"], ["POST", "/api/lista-espera"]]) assert.equal(apiDenied("recepcion", m, p), null, `${m} ${p}`);
  assert.ok(agendaActionDenied("recepcion", "horario"));
  assert.equal(agendaActionDenied("recepcion", "cita"), null);
  assert.equal(statusDenied("recepcion", "cancelada"), null);
});

test("Asistente: lee la ficha y marca llegó/en box/atendida; no escribe ni cobra", () => {
  for (const action of ["addNote", "addPayment", "addBudget", "createPatient", "addAppointment"]) assert.ok(clinicalActionDenied("asistente", action), action);
  assert.equal(apiDenied("asistente", "GET", "/api/anamnesis"), null);
  assert.equal(apiDenied("asistente", "POST", "/api/images"), null);
  assert.ok(apiDenied("asistente", "DELETE", "/api/images/4"));
  assert.ok(apiDenied("asistente", "POST", "/api/anamnesis"));
  assert.ok(apiDenied("asistente", "GET", "/api/dashboard"));
  assert.ok(apiDenied("asistente", "POST", "/api/documentos/emitir"));
  assert.equal(agendaActionDenied("asistente", "estado"), null);
  for (const action of ["cita", "mover", "bloquear", "horario"]) assert.ok(agendaActionDenied("asistente", action), action);
  for (const status of ["en_espera", "ingresada", "atendida", "confirmada"]) assert.equal(statusDenied("asistente", status), null, status);
  for (const status of ["cancelada", "inasistida", "reagendada"]) assert.ok(statusDenied("asistente", status), status);
});

test("la carga inicial de Recepción no lleva nada clínico", () => {
  const load = { patients: [{ id: 1, name: "Paciente Sintético", allergies: "Penicilina", history: "HTA" }], notes: [{ id: 1, body: "x" }], periodontalExams: { 1: [] }, toothStatuses: { 1: {} }, clinicalImages: [{ id: 2 }], budgets: [{ id: 3 }], payments: [{ id: 4 }], appointments: [{ id: 5 }] };
  const filtered = filterClinicalLoad("recepcion", load);
  assert.deepEqual(filtered.notes, []);
  assert.deepEqual(filtered.clinicalImages, []);
  assert.deepEqual(filtered.toothStatuses, {});
  assert.deepEqual(filtered.periodontalExams, {});
  assert.equal(filtered.patients[0].allergies, "");
  assert.equal(filtered.patients[0].history, "");
  assert.deepEqual(filtered.budgets, load.budgets);
  assert.deepEqual(filtered.payments, load.payments);
  assert.equal(filterClinicalLoad("asistente", load), load);
  assert.equal(filterClinicalLoad("titular", load), load);
});

test("menú y pestañas por rol", () => {
  assert.ok(navAllowed("recepcion", "Agenda"));
  assert.ok(navAllowed("recepcion", "Presupuestos"));
  assert.ok(!navAllowed("recepcion", "Documentación"));
  assert.ok(!navAllowed("asistente", "Dashboard"));
  assert.ok(navAllowed("titular", "Documentación"));
  assert.ok(!tabAllowed("recepcion", "evoluciones"));
  assert.ok(tabAllowed("recepcion", "presupuestos"));
  assert.ok(tabAllowed("asistente", "imagenes"));
  assert.equal(firstTab("recepcion"), "presupuestos");
});

test("roles de equipo: invitar recepción y asistente; recepción modifica presupuestos", () => {
  assert.ok(isTeamRole("recepcion") && isTeamRole("asistente") && !isTeamRole("titular"));
  assert.ok(isSupportRole("recepcion") && !isSupportRole("dentista"));
  assert.equal(ROLE_LABEL.recepcion, "Recepción");
  const now = new Date("2026-11-22T12:00:00Z");
  const ok = checkInvite({ email: "Recepcion@Example.test", role: "recepcion" }, { inviterEmail: "dueno@example.test", existing: [], now });
  assert.deepEqual(ok, { ok: true, email: "recepcion@example.test", role: "recepcion" });
  assert.ok(canChangeBudget("otro", "clinica", "yo", "recepcion"));
  assert.ok(!canChangeBudget("otro", "clinica", "yo", "asistente"));
  assert.ok(!canChangeBudget("otro", "clinica", "yo", "dentista"));
});

test("el servidor aplica los permisos (no solo la interfaz) y audita quién hizo cada cambio", () => {
  const worker = readFileSync(new URL("../worker.ts", import.meta.url), "utf8");
  assert.match(worker, /apiDenied\(space\.role, request\.method/);
  const clinical = readFileSync(new URL("../app/api/clinical/route.ts", import.meta.url), "utf8");
  assert.match(clinical, /clinicalActionDenied\(spaceRoleOf\(actor\), action\)/);
  assert.match(clinical, /filterClinicalLoad\(spaceRole, \{/);
  assert.match(clinical, /recordEvent\(actor, kind/);
  const agenda = readFileSync(new URL("../app/api/agenda-box/route.ts", import.meta.url), "utf8");
  assert.match(agenda, /agendaActionDenied\(role, body\.action\)/);
  assert.match(agenda, /recordEvent\(user, AGENDA_AUDIT/);
  const attendance = readFileSync(new URL("../app/api/asistencia/route.ts", import.meta.url), "utf8");
  assert.match(attendance, /statusDenied\(spaceRoleOf\(user\), body\.status\)/);
  const sql = readFileSync(new URL("../drizzle/0017_account_events.sql", import.meta.url), "utf8");
  assert.doesNotMatch(sql, /\b(DROP|ALTER|DELETE|UPDATE)\b/i);
  const events = readFileSync(new URL("../app/account-events.ts", import.meta.url), "utf8");
  assert.match(events, /WHERE owner_id = \? ORDER BY id DESC/);
  // El uso de IA cuenta contra la cuenta del titular (el espacio), no contra la persona.
  for (const route of ["dictation/structure", "text-correction", "anamnesis", "dictation/tooth-answer"]) assert.match(readFileSync(new URL(`../app/api/${route}/route.ts`, import.meta.url), "utf8"), /const account = user\.userId;/, route);
});
