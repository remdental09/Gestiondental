import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  canChangeBudget, canChangeEvolution, canEditClinic, canManageTeam, checkInvite, checkRoleChange, chooseSpace, evolutionAuthor, inviteExpiry,
  inviteEmail, inviteMessage, isExpired, visibleStatus, MAX_MEMBERS,
} from "../lib/clinic-team.ts";

const NOW = new Date("2026-11-16T12:00:00Z");
const TITULAR = "titular-owner-0001";
const COLEGA = "email:colega-0002";
const CLINICA_B = "otra-clinica-0003";
const member = (over = {}) => ({
  clinicId: TITULAR, email: "colega@gmail.com", role: "dentista", status: "activa", invitedBy: TITULAR,
  invitedAt: "2026-11-01T00:00:00Z", expiresAt: "2026-11-15T00:00:00Z", acceptedAt: "2026-11-02T00:00:00Z", revokedAt: null, memberId: COLEGA, name: "", ...over,
});

test("invitar: exige correo válido y rol conocido; por omisión, dentista", () => {
  const ctx = { inviterEmail: "titular@gmail.com", existing: [], now: NOW };
  assert.deepEqual(checkInvite({ email: "  Colega@Gmail.com " }, ctx), { ok: true, email: "colega@gmail.com", role: "dentista" });
  assert.equal(checkInvite({ email: "colega@gmail.com", role: "admin" }, ctx).ok, true);
  for (const email of ["", "sin-arroba", "a@b", 42, null]) assert.equal(checkInvite({ email }, ctx).ok, false, String(email));
  assert.equal(checkInvite({ email: "colega@gmail.com", role: "tecnico" }, ctx).ok, false);
  assert.equal(checkInvite({ email: "colega@gmail.com", role: "titular" }, ctx).ok, false);
});

test("invitar: no a uno mismo, no duplica activos ni pendientes vigentes; una vencida se puede volver a invitar", () => {
  const base = { inviterEmail: "titular@gmail.com", now: NOW };
  assert.equal(checkInvite({ email: "TITULAR@gmail.com" }, { ...base, existing: [] }).ok, false);
  assert.equal(checkInvite({ email: "colega@gmail.com" }, { ...base, existing: [member()] }).ok, false);
  const pendiente = member({ status: "invitada", expiresAt: "2026-11-20T00:00:00Z", acceptedAt: null });
  assert.equal(checkInvite({ email: "colega@gmail.com" }, { ...base, existing: [pendiente] }).ok, false);
  const vencida = member({ status: "invitada", expiresAt: "2026-11-10T00:00:00Z", acceptedAt: null });
  assert.equal(checkInvite({ email: "colega@gmail.com" }, { ...base, existing: [vencida] }).ok, true);
  for (const status of ["revocada", "rechazada"]) assert.equal(checkInvite({ email: "colega@gmail.com" }, { ...base, existing: [member({ status })] }).ok, true, status);
});

test("invitar: tope de miembros abiertos", () => {
  const existing = Array.from({ length: MAX_MEMBERS }, (_, i) => member({ email: `p${i}@gmail.com` }));
  assert.equal(checkInvite({ email: "nuevo@gmail.com" }, { inviterEmail: "t@gmail.com", existing, now: NOW }).ok, false);
});

test("las invitaciones vencen a los 14 días y se muestran como vencidas", () => {
  const expires = inviteExpiry(NOW);
  assert.equal(Date.parse(expires) - NOW.getTime(), 14 * 86_400_000);
  const inv = { status: "invitada", expiresAt: "2026-11-16T11:59:59Z" };
  assert.equal(isExpired(inv, NOW), true);
  assert.equal(visibleStatus(inv, NOW), "vencida");
  assert.equal(isExpired({ status: "activa", expiresAt: "2020-01-01T00:00:00Z" }, NOW), false, "una membresía activa no vence");
});

test("espacio: sin membresías se trabaja en el propio", () => {
  assert.deepEqual(chooseSpace(COLEGA, [], null), { spaceId: COLEGA, role: "titular", clinicId: null });
  assert.deepEqual(chooseSpace(COLEGA, [], TITULAR), { spaceId: COLEGA, role: "titular", clinicId: null }, "una cookie sin membresía no abre una clínica ajena");
});

test("espacio: quien aceptó entra a la clínica, salvo que haya elegido su espacio personal", () => {
  const active = [member()];
  assert.deepEqual(chooseSpace(COLEGA, active, null), { spaceId: TITULAR, role: "dentista", clinicId: TITULAR });
  assert.deepEqual(chooseSpace(COLEGA, active, TITULAR), { spaceId: TITULAR, role: "dentista", clinicId: TITULAR });
  assert.equal(chooseSpace(COLEGA, active, COLEGA).spaceId, COLEGA);
});

test("espacio: una cookie de una clínica de la que ya no es miembro vuelve al espacio personal", () => {
  assert.equal(chooseSpace(COLEGA, [member()], CLINICA_B).spaceId, COLEGA);
  assert.equal(chooseSpace(COLEGA, [], TITULAR).spaceId, COLEGA, "revocado: pierde el acceso en la siguiente solicitud");
});

test("espacio: con varias clínicas, entra a la última aceptada; el rol es el de esa clínica", () => {
  const active = [member(), member({ clinicId: CLINICA_B, role: "admin", acceptedAt: "2026-11-10T00:00:00Z" })];
  assert.deepEqual(chooseSpace(COLEGA, active, null), { spaceId: CLINICA_B, role: "admin", clinicId: CLINICA_B });
  assert.equal(chooseSpace(COLEGA, active, TITULAR).role, "dentista");
});

test("espacio: una fila que apunta al propio espacio no cambia el rol de titular", () => {
  assert.deepEqual(chooseSpace(COLEGA, [member({ clinicId: COLEGA, role: "dentista" })], null), { spaceId: COLEGA, role: "titular", clinicId: null });
});

test("permisos: titular y administrador gestionan el equipo y el perfil de la clínica; el dentista no", () => {
  assert.equal(canManageTeam("titular"), true);
  assert.equal(canManageTeam("admin"), true);
  assert.equal(canManageTeam("dentista"), false);
  assert.equal(canEditClinic("dentista"), false);
});

test("autoría: solo quien escribió una evolución la cambia; las antiguas son del titular", () => {
  assert.equal(evolutionAuthor(null, TITULAR), TITULAR);
  assert.equal(canChangeEvolution(null, TITULAR, TITULAR), true);
  assert.equal(canChangeEvolution(null, TITULAR, COLEGA), false);
  assert.equal(canChangeEvolution(COLEGA, TITULAR, COLEGA), true);
  assert.equal(canChangeEvolution(COLEGA, TITULAR, TITULAR), false, "ni el titular cambia la evolución de un colega");
});

test("cambio de rol: solo roles válidos y personas aún en el equipo", () => {
  assert.deepEqual(checkRoleChange(member(), "admin"), { ok: true, role: "admin" });
  assert.equal(checkRoleChange(member(), "titular").ok, false);
  assert.equal(checkRoleChange(member({ status: "revocada" }), "admin").ok, false);
});

test("el mensaje de invitación explica que se entra con el mismo Gmail y no trae enlace secreto", () => {
  const text = inviteMessage("Clínica Sonrisa", "Dr. Luis Rodríguez", "https://speakdent.cl");
  assert.ok(text.includes("Clínica Sonrisa") && text.includes("https://speakdent.cl") && text.includes("Gmail"));
  assert.ok(!/token|codigo|código=/.test(text));
  assert.ok(inviteMessage("", "", "https://speakdent.cl").includes("nuestra clínica"));
});

const worker = readFileSync(new URL("../worker.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/clinical/route.ts", import.meta.url), "utf8");
const equipo = readFileSync(new URL("../app/api/equipo/route.ts", import.meta.url), "utf8");

test("worker: el espacio sale de la membresía en la base y las cabeceras entrantes se borran", () => {
  assert.ok(worker.includes("activeMemberships(db") && worker.includes("chooseSpace("));
  assert.ok(worker.includes("headers.set(ACCESS_OWNER_ID_HEADER, space.spaceId)"));
  assert.ok(worker.includes("headers.set(PERSONAL_ID_HEADER, identity.owner.ownerId)"));
  const clear = worker.slice(worker.indexOf("function clearInboundIdentityHeaders"), worker.indexOf("// ---------- Inicio de sesión"));
  assert.ok(clear.includes("PERSONAL_ID_HEADER") && clear.includes("SPACE_ROLE_HEADER"), "nadie puede inyectar su propio espacio o rol");
  const resolve = worker.slice(worker.indexOf("async function resolveSpace"), worker.indexOf("async function privateAppFetch"));
  assert.ok(resolve.includes("catch") && resolve.includes("return personal"), "si la base falla, se queda en el espacio personal");
});

test("ruta clínica: corregir, anular, eliminar o etiquetar una evolución exige ser su autor", () => {
  for (const action of ["updateEvolution", "annulEvolution", "deleteEvolution", "setEvolutionDiagnoses"]) {
    const start = route.indexOf(`action === "${action}"`);
    const block = route.slice(start, route.indexOf("if (action ===", start + 20));
    assert.ok(block.includes("mayChangeEvolution(ownerId, evolutionId)") && block.includes("403"), action);
  }
  const add = route.slice(route.indexOf('action === "addNote"'), route.indexOf('action === "updateEvolution"'));
  assert.ok(add.includes("db.batch([db.insert(evolutions)") && add.includes("(await authorStatement(db, ownerId)).statement]"), "el autor va en el mismo batch que la evolución");
  assert.equal(route.split("(await authorStatement(db, ownerId)).statement]").length - 1, 3, "nueva, reemplazo al anular y reemplazo al eliminar");
  assert.ok(route.includes("evolutionId: sql`last_insert_rowid()`"));
});

test("API de equipo: solo administradores invitan, revocan o cambian roles; aceptar exige una invitación vigente a su correo", () => {
  assert.ok(equipo.includes('if (!manage) return fail("Solo un administrador puede invitar.", 403)'));
  assert.ok(equipo.includes('if (!manage) return fail("Solo un administrador puede cambiar el equipo.", 403)'));
  assert.ok(equipo.includes("membershipsOf(db, myEmail)") && equipo.includes("isExpired(invite, now)"));
  assert.ok(equipo.includes('m.status === "activa"') && equipo.includes("No perteneces a ese espacio."));
});

test("conexiones compartidas (Drive, calendarios, correo de citas, envío de agenda): solo titular o administrador las cambia", () => {
  const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
  for (const path of ["../app/api/drive/connect/route.ts", "../app/api/drive/callback/route.ts"]) assert.ok(read(path).includes("if (!managesSpace(user))"), path);
  assert.ok(read("../app/api/calendar/route.ts").includes('(body?.action === "setCalendar" || body?.action === "remove") && !managesSpace(user)'));
  const mail = read("../app/api/appointment-mail/route.ts");
  for (const fn of ["PUT", "DELETE"]) {
    const start = mail.indexOf(`export async function ${fn}`);
    assert.ok(mail.slice(start, mail.indexOf("export async function", start + 10) >>> 0 || undefined).includes("managesSpace(user)"), fn);
  }
  const digest = read("../app/api/agenda-digest/route.ts");
  const put = digest.slice(digest.indexOf("export async function PUT"), digest.indexOf("export async function POST"));
  assert.ok(put.includes("managesSpace(user)"));
});

test("perfil, aranceles y PDF del presupuesto son de cada profesional; el perfil de la clínica lo cambia un administrador", () => {
  const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
  assert.ok(read("../app/api/profile/route.ts").includes("loadProfile(personalIdOf(user))"));
  assert.ok(read("../app/api/aranceles/route.ts").includes("personalIdOf(viewer)"));
  assert.ok(read("../app/api/aranceles/custom/route.ts").includes("personalIdOf(viewer)"));
  assert.ok(read("../app/api/clinica/route.ts").includes("canEditClinic(spaceRoleOf(user))"));
  assert.ok(read("../app/api/importar-plataforma/route.ts").includes("canManageTeam(spaceRoleOf(viewer))"));
});

test("interfaz: la evolución de otro profesional muestra su autor y no ofrece editar ni eliminar", () => {
  const history = readFileSync(new URL("../components/evolution-history.tsx", import.meta.url), "utf8");
  assert.ok(history.includes('note.mine === false && <p') && history.includes('data-testid="note-author"'));
  assert.ok(history.includes("{note.mine !== false && <div"));
  const page = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.ok(page.includes("<ClinicSpaceBar/>") && page.includes("<EquipoPanel/>"));
});

test("revisión: panel de desarrollador por id personal; importar desde Drive y enviar la agenda solo administradores; transcripción por persona", () => {
  const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
  for (const path of ["../app/api/mejora/route.ts", "../app/api/auditoria/route.ts"]) assert.ok(read(path).includes("personalIdOf(user) !== owner || user.userId !== owner"), path);
  const drive = route.slice(route.indexOf('action === "previewDriveRecords" || action === "importDriveRecords"'));
  assert.ok(drive.slice(0, 300).includes("canManageTeam(spaceRoleOf(importer))"));
  const digest = read("../app/api/agenda-digest/route.ts");
  const post = digest.slice(digest.indexOf("export async function POST"));
  assert.ok(post.includes("if (!managesSpace(user))"));
  assert.ok(read("../app/api/audio-transcription/route.ts").includes("const owner = personalIdOf(user);"));
  const mail = read("../app/budget-mail.ts");
  assert.ok(mail.includes("professionalId === ownerId ? profile?.clinicName : space?.clinicName"), "nombre de clínica del espacio en PDF y correo");
});

test("presupuesto: queda a nombre de quien lo armó (p. ej. el ortodoncista invitado), lo descargue o envíe quien sea", () => {
  const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
  const create = route.slice(route.indexOf('action === "addBudget"'), route.indexOf('action === "updateBudget"'));
  assert.ok(create.includes("db.batch([db.insert(budgets)") && create.includes("(await budgetAuthorStatement(db, ownerId)).statement]"), "autor en el mismo batch que el presupuesto");
  assert.ok(route.includes("budgetId: sql`last_insert_rowid()`"));
  const mail = read("../app/budget-mail.ts");
  assert.ok(mail.includes("await budgetAuthorOf(") && mail.includes("const professionalId = author || ownerId;"), "PDF con el autor; los antiguos, del titular");
  assert.ok(mail.includes("No pude confirmar qué profesional armó este presupuesto"), "si la lectura falla, no firma con otro profesional");
  for (const path of ["../app/api/presupuesto/pdf/route.ts", "../app/api/presupuesto/enviar/route.ts"]) assert.ok(!read(path).includes("personalIdOf"), `${path}: no usa a quien descarga o envía`);
  assert.ok(read("../components/budget-plan.tsx").includes("Presupuesto de ${budget.authorName}"));
});

test("presupuesto: lo modifican quien lo armó y el dueño de la clínica (o sus administradores), no otro dentista invitado", () => {
  const ORTODONCISTA = "email:ortodoncista-0004";
  assert.equal(canChangeBudget(ORTODONCISTA, TITULAR, ORTODONCISTA, "dentista"), true, "el ortodoncista modifica el suyo");
  assert.equal(canChangeBudget(ORTODONCISTA, TITULAR, TITULAR, "titular"), true, "el dueño modifica el del ortodoncista");
  assert.equal(canChangeBudget(ORTODONCISTA, TITULAR, COLEGA, "admin"), true, "un administrador nombrado por el dueño también");
  assert.equal(canChangeBudget(ORTODONCISTA, TITULAR, COLEGA, "dentista"), false, "otro invitado no");
  assert.equal(canChangeBudget(null, TITULAR, ORTODONCISTA, "dentista"), false, "los antiguos son del dueño");
  assert.equal(canChangeBudget(null, TITULAR, TITULAR, "titular"), true);
  for (const action of ["updateBudget", "selectBudgetAlternative"]) {
    const start = route.indexOf(`action === "${action}"`);
    const block = route.slice(start, route.indexOf("if (action ===", start + 20));
    assert.ok(block.includes(".editable) return error(NOT_BUDGET_OWNER, 403)"), action);
  }
  const plan = readFileSync(new URL("../components/budget-plan.tsx", import.meta.url), "utf8");
  assert.ok(plan.includes("onEdit && budget.editable !== false") && plan.includes("onSelectPrimary && budget.editable !== false"));
});

test("la invitación se envía sola por correo desde el Gmail conectado y nunca bloquea si falla", () => {
  const mail = inviteEmail({ clinicName: "Clínica <Norte>", inviterName: "Dr(a). Ana Pérez", appUrl: "https://speakdent.cl", invitedEmail: "colega@gmail.com", roleLabel: "Dentista" });
  assert.match(mail.subject, /Dr\(a\)\. Ana Pérez te invitó a Clínica <Norte> en SpeakDent/);
  assert.match(mail.text, /Entrar con Google/);
  assert.match(mail.text, /colega@gmail\.com/);
  assert.match(mail.html, /href="https:\/\/speakdent\.cl"/);
  assert.match(mail.html, /Clínica &lt;Norte&gt;/, "el HTML escapa el nombre de la clínica");
  assert.doesNotMatch(mail.html, /token|codigo=|code=/i, "sin enlace secreto: el acceso lo da el Gmail invitado");

  const route = readFileSync(new URL("../app/api/equipo/route.ts", import.meta.url), "utf8");
  assert.match(route, /const mail = await mailInvite\(clinicId, personalId, checked\.email/);
  assert.match(route, /const mail = await mailInvite\(clinicId, personalId, email, target\.role/, "renovar también reenvía el correo");
  assert.match(route, /upsertInvite\(.*\);\n\s+const mail = await mailInvite/, "la invitación se guarda antes de intentar el correo");
  assert.match(route, /catch \(error\) \{\n\s+return \{ sent: false, to, reason: "error"/, "un fallo de Gmail no rompe la invitación");
  const panel = readFileSync(new URL("../components/equipo-panel.tsx", import.meta.url), "utf8");
  assert.match(panel, /invite-mail-sent/);
  assert.match(panel, /invite-mail-none/);
});
