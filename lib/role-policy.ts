/**
 * Permisos por rol dentro de una cuenta (clínica). Se aplican EN EL SERVIDOR:
 *  1) el Worker revisa cada /api/* según el rol de la sesión (`apiDenied`), antes de llegar a la ruta;
 *  2) /api/clinical revisa cada acción (`clinicalActionDenied`) y recorta la carga inicial (`filterClinicalLoad`);
 *  3) la agenda revisa qué estados puede marcar cada rol (`statusDenied`).
 * La interfaz además esconde lo que no corresponde (`navAllowed`, `tabAllowed`), pero eso es solo comodidad.
 *
 * Titular, administrador y dentista colaborador: sin cambios (todo, con las reglas de autoría de siempre).
 * Recepción: agenda completa, datos administrativos del paciente, presupuestos, pagos, controles, dashboard.
 *   No ve evoluciones, anamnesis, diagnósticos, periodontograma, odontograma, imágenes, recetas ni dictado.
 * Asistente: agenda (ver y marcar llegó / en box / atendida), ficha en lectura (incluye evoluciones) y subir imágenes.
 *   No crea ni firma evoluciones o recetas, no cobra y no cambia configuración.
 */
export type AccessRole = "titular" | "admin" | "dentista" | "recepcion" | "asistente";
export type StaffRole = "recepcion" | "asistente";

export const isStaffRole = (role: unknown): role is StaffRole => role === "recepcion" || role === "asistente";
export const ACCESS_ROLE_LABEL: Record<AccessRole, string> = { titular: "Titular", admin: "Administrador", dentista: "Dentista colaborador", recepcion: "Recepción", asistente: "Asistente" };

const READ = new Set(["GET", "HEAD"]);

/** Rutas que cada rol puede LEER (prefijos exactos de segmento). */
const READS: Record<StaffRole, string[]> = {
  recepcion: [
    "/api/clinical", "/api/agenda-box", "/api/box", "/api/asistencia", "/api/appointment-confirmations", "/api/controles", "/api/dashboard",
    "/api/calendar", "/api/presupuesto", "/api/aranceles", "/api/profesionales", "/api/equipo", "/api/estado", "/api/clinica", "/api/profile",
    "/api/preferencias", "/api/lista-espera", "/api/drive/status", "/api/appointment-mail", "/api/llamar",
  ],
  asistente: [
    "/api/clinical", "/api/agenda-box", "/api/box", "/api/asistencia", "/api/images", "/api/anamnesis", "/api/endodontics", "/api/orthodontics",
    "/api/documentos", "/api/alertas", "/api/controles", "/api/aranceles", "/api/profesionales", "/api/equipo", "/api/estado", "/api/clinica",
    "/api/profile", "/api/preferencias", "/api/lista-espera", "/api/drive/status", "/api/calendar", "/api/presupuesto/pdf",
  ],
};

/** Escrituras permitidas: método + ruta exacta. Lo fino (qué acción, qué estado) lo revisa cada ruta. */
const WRITES: Record<StaffRole, string[]> = {
  recepcion: [
    "POST /api/clinical", "POST /api/agenda-box", "PUT /api/asistencia", "PUT /api/appointment-confirmations",
    "POST /api/controles", "PATCH /api/controles", "DELETE /api/controles", "POST /api/presupuesto/enviar", "POST /api/presupuesto/pdf",
    "POST /api/equipo", "POST /api/lista-espera", "POST /api/appointment-mail", "POST /api/llamar",
    "POST /api/ingreso-paciente/enlace",
    // Agenda semanal (editar/borrar/asignar paciente). Conectar o quitar calendarios sigue siendo solo del dueño (managesSpace en la ruta).
    "POST /api/calendar",
  ],
  asistente: ["POST /api/agenda-box", "PUT /api/asistencia", "POST /api/images", "POST /api/equipo"],
};

/** Las cuentas de equipo de la clínica (/api/equipo) solo aceptan estas acciones de un rol de apoyo. */
export const STAFF_TEAM_ACTIONS = new Set(["aceptar", "rechazar", "salir", "espacio"]);

const under = (path: string, prefix: string) => path === prefix || path.startsWith(prefix + "/");

export const ROLE_DENIED = "Tu rol en esta clínica no permite esta acción. Pídeselo al dentista a cargo.";

/** null si el rol puede usar esta ruta; si no, el mensaje (403). Solo restringe a Recepción y Asistente. */
export function apiDenied(role: string | null | undefined, method: string, path: string): string | null {
  if (!isStaffRole(role) || !path.startsWith("/api/")) return null;
  const verb = method.toUpperCase();
  if (READ.has(verb)) {
    if (path.startsWith("/api/clinical/export")) return ROLE_DENIED;
    return READS[role].some(prefix => under(path, prefix)) ? null : ROLE_DENIED;
  }
  return WRITES[role].includes(`${verb} ${path}`) ? null : ROLE_DENIED;
}

/** Acciones de POST /api/clinical que Recepción puede hacer (administrativas, presupuestos, pagos y agenda). */
const RECEPTION_ACTIONS = new Set([
  "createPatient", "updatePatient", "addBudget", "updateBudget", "setBudgetStatus", "addBudgetItems", "selectBudgetAlternative",
  "addPayment", "addAppointment", "updateAppointment", "deleteAppointment", "updateAppointmentReason", "importCalendarEvents",
]);

export function clinicalActionDenied(role: string | null | undefined, action: unknown): string | null {
  if (role === "recepcion") return typeof action === "string" && RECEPTION_ACTIONS.has(action) ? null : ROLE_DENIED;
  if (role === "asistente") return ROLE_DENIED; // la asistente lee la ficha; no escribe en ella
  return null;
}

/** Acciones de /api/agenda-box por rol: horarios de los profesionales son configuración (solo el titular/administrador). */
export function agendaActionDenied(role: string | null | undefined, action: unknown): string | null {
  if (role === "recepcion") return action === "horario" || action === "borrarHorario" ? ROLE_DENIED : null;
  if (role === "asistente") return action === "estado" ? null : ROLE_DENIED;
  return null;
}

/** La asistente marca solo el paso por la clínica: llegó, en box, atendida (y volver a confirmada si se equivocó). */
const ASSISTANT_STATUSES = new Set(["confirmada", "en_espera", "ingresada", "atendida"]);
export function statusDenied(role: string | null | undefined, status: unknown): string | null {
  if (role === "asistente") return typeof status === "string" && ASSISTANT_STATUSES.has(status) ? null : ROLE_DENIED;
  return null;
}
/** Estados que el rol puede elegir en un selector (siempre incluye el actual, para que se vea). */
export function selectableStatuses<T extends string>(role: string | null | undefined, all: readonly T[], current?: T): T[] {
  return all.filter(status => status === current || !statusDenied(role, status));
}

/** Secciones del menú visibles por rol. */
const NAV: Record<StaffRole, Set<string>> = {
  recepcion: new Set(["Inicio", "Dashboard", "Pacientes", "Ficha clínica", "Agenda", "Controles", "Presupuestos", "Configuración"]),
  asistente: new Set(["Inicio", "Pacientes", "Ficha clínica", "Agenda", "Controles", "Configuración"]),
};
export const navAllowed = (role: string | null | undefined, section: string) => !isStaffRole(role) || NAV[role].has(section);

/** Pestañas de la ficha por rol. Recepción: solo presupuestos (datos administrativos van en el encabezado). */
const TABS: Record<StaffRole, Set<string>> = {
  recepcion: new Set(["presupuestos"]),
  asistente: new Set(["evoluciones", "odontograma", "periodontograma", "imagenes", "endodoncia", "ortodoncia", "presupuestos"]),
};
export const tabAllowed = (role: string | null | undefined, tab: string) => !isStaffRole(role) || TABS[role].has(tab);
export const firstTab = (role: string | null | undefined) => (role === "recepcion" ? "presupuestos" : "evoluciones");

/** Puede escribir en la ficha clínica (evoluciones, odontograma, dictado, recetas). */
export const writesClinical = (role: string | null | undefined) => !isStaffRole(role);

type ClinicalLoad = {
  patients?: Array<Record<string, unknown>>;
  notes?: unknown[];
  periodontalExams?: Record<string, unknown>;
  toothStatuses?: Record<string, unknown>;
  clinicalImages?: unknown[];
  [key: string]: unknown;
};

/** Carga inicial de /api/clinical sin lo clínico para Recepción (lo demás roles la reciben completa). */
export function filterClinicalLoad<T extends ClinicalLoad>(role: string | null | undefined, load: T): T {
  if (role !== "recepcion") return load;
  return {
    ...load,
    patients: (load.patients ?? []).map(patient => ({ ...patient, allergies: "", history: "" })),
    notes: [],
    periodontalExams: {},
    toothStatuses: {},
    clinicalImages: [],
  };
}
