import { and, desc, eq, gt, inArray, ne } from "drizzle-orm";
import { formatFdi } from "@/app/clinical-data";
import { ClinicalImportError, runDriveRecordImport } from "@/app/clinical-import";
import { confirmDriveSnapshot, getDriveSnapshot, listDriveBackupQueue } from "@/app/drive-backup";
import { getDb } from "@/db";
import { syncInstalledImplants } from "@/app/sync-odontogram";
import { bestStoredNameMatches, hasFourNameParts, normalizePatientName, storedNameMatchScore } from "@/app/patient-identity";
import { calendarEvents, evolutions, patients, toothStatuses } from "@/db/schema";

export const runtime = "edge";
export const dynamic = "force-dynamic";

type JsonRecord = Record<string, unknown>;
type JsonRpcId = string | number | null;

const now = () => new Date().toISOString();
const string = (value: unknown, max: number) => typeof value === "string" ? value.trim().slice(0, max) : "";
const cleanRut = (value: string) => value.toUpperCase().replace(/[^0-9K]/g, "");
const validPhone = (value: string) => !value || (/^[+\d()\s.-]{7,24}$/.test(value) && value.replace(/\D/g, "").length >= 8);
const validEmail = (value: string) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const validRut = (value: string) => {
  const normalized = cleanRut(value), body = normalized.slice(0, -1), digit = normalized.slice(-1);
  if (!/^\d{1,9}$/.test(body) || !/^[0-9K]$/.test(digit)) return false;
  let sum = 0, multiplier = 2;
  for (let i = body.length - 1; i >= 0; i--) { sum += Number(body[i]) * multiplier; multiplier = multiplier === 7 ? 2 : multiplier + 1; }
  const result = 11 - sum % 11;
  return (result === 11 ? "0" : result === 10 ? "K" : String(result)) === digit;
};
const dateInChile = (value = new Date()) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(value);
const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const dateIsFuture = (value: string) => value > dateInChile();
const driveIdPattern = /^[A-Za-z0-9_-]{10,200}$/;
async function verifyWriteIdentity(ownerId: string, patientId: number, storedName: string, args: JsonRecord, db: ReturnType<typeof getDb>) {
  const selectedNameScore = storedNameMatchScore(args.fullName, storedName);
  if (selectedNameScore === 0) return { identityMismatch: true, patientName: storedName, message: "El nombre dictado no coincide con los componentes registrados en esta ficha; no se escribió." };
  const rut = string(args.identityRut, 20);
  const birthDate = string(args.identityBirthDate, 10);
  if (rut && !validRut(rut)) return { identityMismatch: true, patientName: storedName, message: "El RUT adicional no valida; no se escribió." };
  if (birthDate && !validDate(birthDate)) return { identityMismatch: true, patientName: storedName, message: "La fecha de nacimiento adicional no es válida; no se escribió." };
  const ownerPatients = await db.select({ id: patients.id, name: patients.name, rut: patients.rut, birthDate: patients.birthDate }).from(patients).where(and(eq(patients.ownerId, ownerId))).limit(10000);
  const compatibleNames = ownerPatients.filter(candidate => storedNameMatchScore(args.fullName, candidate.name) > 0);
  const identifiedNames = compatibleNames.filter(candidate => (!rut || candidate.rut === cleanRut(rut)) && (!birthDate || candidate.birthDate === birthDate));
  if ((rut || birthDate) && !identifiedNames.length) return { identityMismatch: true, patientName: storedName, message: "El RUT o la fecha de nacimiento no identifica esta ficha; no se escribió." };
  const sameName = bestStoredNameMatches(string(args.fullName, 180), (rut || birthDate) ? identifiedNames : compatibleNames);
  if (!sameName.some(candidate => candidate.id === patientId)) return { identityMismatch: true, patientName: storedName, message: "La ficha seleccionada no es la que mejor coincide con el nombre dictado; no se escribió." };
  if (sameName.length > 1) {
    const resolved = sameName.filter(candidate => (!rut || candidate.rut === cleanRut(rut)) && (!birthDate || candidate.birthDate === birthDate));
    if ((!rut && !birthDate) || resolved.length !== 1 || resolved[0].id !== patientId) return { needsClarification: true, patientName: storedName, matches: sameName.map(candidate => ({ name: candidate.name, birthDate: candidate.birthDate, rut: candidate.rut || "" })), message: "Hay fichas homónimas. Indica RUT o fecha de nacimiento que distinga exactamente esta ficha; no se escribió." };
  } else if (sameName.length === 1 && sameName[0].id !== patientId) {
    return { identityMismatch: true, patientName: storedName, message: "La ficha seleccionada no corresponde al nombre indicado; no se escribió." };
  }
  return null;
}
const patientFields = { id: patients.id, name: patients.name, birthDate: patients.birthDate, rut: patients.rut, phone: patients.phone, email: patients.email, reason: patients.reason, status: patients.status, driveFolderId: patients.driveFolderId };

const tools = [
  {
    name: "find_patient",
    title: "Buscar paciente",
    description: "Busca una ficha de Gestión Dental por RUT o nombre. Prefiere el RUT cuando esté disponible. Para fichas antiguas con nombres incompletos, compara los componentes dictados y prioriza la ficha con más componentes coincidentes; si hay empate, pide fecha de nacimiento o RUT. Si no hay coincidencia aquí, busca también en Google Drive antes de decir que es un paciente nuevo.",
    inputSchema: { type: "object", properties: { query: { type: "string", description: "RUT completo o nombre del paciente" } }, required: ["query"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "get_patient_record",
    title: "Abrir ficha clínica",
    description: "Lee la ficha de un paciente ya identificado. Úsala solo después de confirmar una coincidencia por RUT o de aclarar cuál paciente es. Devuelve datos básicos y hasta 10 evoluciones recientes.",
    inputSchema: { type: "object", properties: { patientId: { type: "integer", description: "ID entregado por find_patient" } }, required: ["patientId"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "create_patient",
    title: "Crear ficha de paciente",
    description: "Crea una ficha en la base de Gestión Dental después de buscar primero en la app y Google Drive y solo tras la confirmación expresa del clínico. Al registrar pacientes nuevos, solicita los dos nombres y los dos apellidos cuando estén disponibles; no inventes ni infieras nombres. Si Drive ya tiene una carpeta de esa persona, vincúlala en vez de crear otra. Si el nombre ya existe y no hay RUT, aclara si es otra persona antes de usar confirmDifferentPatient=true.",
    inputSchema: { type: "object", properties: { name: { type: "string", description: "Nombre completo" }, birthDate: { type: "string", description: "Fecha de nacimiento AAAA-MM-DD" }, rut: { type: "string", description: "RUT chileno, si se conoce" }, phone: { type: "string", description: "Teléfono, si se conoce" }, email: { type: "string", description: "Correo electrónico, si se conoce" }, reason: { type: "string", description: "Motivo de consulta, si se conoce" }, driveFolderId: { type: "string", description: "ID de la carpeta de Google Drive, si existe" }, driveSearchChecked: { type: "boolean", description: "true solo después de buscar y resolver si existe una ficha coincidente en Google Drive" }, confirmed: { type: "boolean", description: "true solo después de que el clínico confirme guardar" }, confirmDifferentPatient: { type: "boolean", description: "true solo después de aclarar que es otra persona con el mismo nombre" } }, required: ["name", "birthDate", "driveSearchChecked", "confirmed"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "update_patient_contact",
    title: "Actualizar contacto del paciente",
    description: "Actualiza únicamente campos confirmados de contacto. Envía el nombre dictado con todos los componentes que el clínico conozca y el ID verificado; una ficha antigua puede tener menos nombres. El servidor prioriza la coincidencia de más componentes y solicita RUT o fecha de nacimiento si hay empate. Los campos omitidos se conservan. Guarda solo después de la orden expresa del clínico y relee la ficha para verificar el cambio.",
    inputSchema: { type: "object", properties: { patientId: { type: "integer", description: "ID de la ficha encontrada" }, fullName: { type: "string", description: "Nombre registrado o nombre dictado con todos los componentes conocidos; la ficha puede tener menos componentes" }, identityBirthDate: { type: "string", description: "Fecha de nacimiento para distinguir homónimos, si hace falta" }, identityRut: { type: "string", description: "RUT vigente para distinguir homónimos, si hace falta" }, rut: { type: "string", description: "RUN / RUT chileno que se desea guardar; omitir para conservarlo" }, phone: { type: "string", description: "Teléfono confirmado; omitir para conservarlo" }, email: { type: "string", description: "Correo confirmado; omitir para conservarlo" }, confirmed: { type: "boolean", description: "true solo después de la orden expresa del clínico" } }, required: ["patientId", "fullName", "confirmed"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "append_clinical_evolution",
    title: "Agregar evolución clínica",
    description: "Agrega una evolución a una ficha existente. Pide al clínico los cuatro nombres cuando pueda proporcionarlos, muestra siempre el nombre tal como figura en la ficha y busca la mejor coincidencia por componentes, permitiendo que la ficha registrada tenga menos nombres. Si hay empate o la coincidencia es débil, pide RUT o fecha de nacimiento y no escribas mientras no se resuelva. La fecha clínica predeterminada es hoy en Chile; usa otra fecha solo si el clínico la indica. Guarda únicamente después de que el clínico confirme. Si la evolución ya se actualizó en Google Drive, incluye sourceDocumentId; si todavía no, informa que el respaldo queda pendiente y usa Drive para añadirla como nueva sección fechada del documento existente, sin reemplazar el historial. Después de que Drive confirme, usa link_drive_backup.",
    inputSchema: { type: "object", properties: { patientId: { type: "integer", description: "ID de la ficha encontrada" }, fullName: { type: "string", description: "Nombre registrado o nombre dictado con todos los componentes conocidos; la ficha puede tener menos componentes" }, identityBirthDate: { type: "string", description: "Fecha de nacimiento para distinguir homónimos, si hace falta" }, identityRut: { type: "string", description: "RUT para distinguir homónimos, si hace falta" }, clinicalDate: { type: "string", description: "Fecha de atención AAAA-MM-DD; omitir para hoy en Chile" }, title: { type: "string", description: "Título breve; opcional" }, body: { type: "string", description: "Evolución clínica redactada y revisada" }, sourceDocumentId: { type: "string", description: "ID del documento de Drive actualizado, si ya se hizo el respaldo" }, requestId: { type: "string", description: "Clave idempotente opcional para evitar duplicar la misma solicitud" }, confirmed: { type: "boolean", description: "true solo después de que el clínico confirme guardar" } }, required: ["patientId", "fullName", "body", "confirmed"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  {
    name: "evolve_patient_by_name",
    title: "Registrar evolución por nombre",
    description: "Cuando el clínico pide registrar una evolución, solicita los cuatro nombres cuando los conozca, pero permite que la ficha existente tenga un nombre incompleto. Selecciona la mejor coincidencia por componentes dictados, muestra el nombre registrado y usa fecha de nacimiento o RUT para resolver empates; nunca completes nombres por inferencia. La orden explícita del clínico autoriza el guardado; no pidas una segunda confirmación. No crees una ficha si no hay coincidencia. Conserva la nomenclatura dental y no infieras hallazgos. La fecha predeterminada es hoy en Chile. Devuelve la evolución releída; informa si el respaldo en Drive queda pendiente.",
    inputSchema: { type: "object", properties: { name: { type: "string", description: "Nombre completo del paciente" }, rut: { type: "string", description: "RUT completo para distinguir homónimos, si se conoce" }, birthDate: { type: "string", description: "Fecha de nacimiento AAAA-MM-DD para distinguir homónimos, si se conoce" }, clinicalDate: { type: "string", description: "Fecha de atención AAAA-MM-DD; omitir para hoy en Chile" }, title: { type: "string", description: "Título breve; opcional" }, body: { type: "string", description: "Evolución clínica sin datos inventados" }, requestId: { type: "string", description: "Clave idempotente opcional para reintentos de la misma solicitud" } }, required: ["name", "body"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  {
    name: "set_tooth_status",
    title: "Actualizar estado general de una pieza",
    description: "Actualiza el estado general de una pieza del odontograma de una ficha ya identificada. Envía todos los componentes del nombre que el clínico conozca junto con el ID; permite coincidencia con nombres registrados incompletos y solicita RUT o fecha de nacimiento ante empate. La interfaz muestra FDI con punto (1.2, 1.3, 2.1); el almacenamiento usa el entero compacto (1.2 se guarda como 12). En esta aplicación, una referencia dictada como 'pieza 12' sin etiqueta FDI usa numeración nacional chilena y corresponde a FDI 2.4; no la interpretes como FDI 1.2. Modifica solo la pieza indicada y conserva las superficies y demás datos del odontograma. Llama solo después de que el clínico haya confirmado explícitamente el registro.",
    inputSchema: { type: "object", properties: { patientId: { type: "integer", description: "ID de la ficha clínica ya identificada" }, fullName: { type: "string", description: "Nombre registrado o nombre dictado con todos los componentes conocidos; la ficha puede tener menos componentes" }, identityBirthDate: { type: "string", description: "Fecha de nacimiento para distinguir homónimos, si hace falta" }, identityRut: { type: "string", description: "RUT para distinguir homónimos, si hace falta" }, toothFDI: { type: "integer", description: "Código FDI compacto para almacenamiento (por ejemplo, entero 12 representa FDI 1.2); no es numeración nacional chilena" }, status: { type: "string", enum: ["Sin hallazgos", "Implante", "Corona", "Ausente", "Indicación de exodoncia", "Resto radicular con endodoncia"] }, confirmed: { type: "boolean", description: "true solo tras confirmación expresa del clínico" } }, required: ["patientId", "fullName", "toothFDI", "status", "confirmed"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  {
    name: "link_drive_backup",
    title: "Vincular respaldo de Drive",
    description: "Registra en la ficha que Google Drive confirmó una carpeta o documento. Envía el nombre tal como está registrado o el nombre dictado con sus componentes conocidos; el servidor permite fichas incompletas y exige RUT o fecha de nacimiento si hay empate. Llama solo después de que una acción de Drive haya tenido éxito y el clínico haya autorizado el respaldo. No uses un ID supuesto.",
    inputSchema: { type: "object", properties: { patientId: { type: "integer" }, fullName: { type: "string", description: "Nombre registrado o nombre dictado con todos los componentes conocidos; la ficha puede tener menos componentes" }, identityBirthDate: { type: "string", description: "Fecha de nacimiento para distinguir homónimos, si hace falta" }, identityRut: { type: "string", description: "RUT para distinguir homónimos, si hace falta" }, evolutionId: { type: "integer", description: "ID devuelto al guardar la evolución, si corresponde" }, sourceDocumentId: { type: "string", description: "ID exacto del Google Doc confirmado" }, driveFolderId: { type: "string", description: "ID exacto de la carpeta del paciente, si corresponde" }, confirmed: { type: "boolean", description: "true solo tras autorización del clínico y confirmación de éxito de Drive" } }, required: ["patientId", "fullName", "confirmed"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "list_drive_backup_queue",
    title: "Listar respaldos pendientes",
    description: "Lista por páginas las fichas que cambiaron desde su último respaldo verificado en Drive. Usa nextAfterPatientId para recorrer todas las páginas. Los adjuntos de imágenes/PDF no están incluidos en el documento de respaldo.",
    inputSchema: { type: "object", properties: { afterPatientId: { type: "integer", description: "Cursor de la página anterior; omitir en la primera" } }, additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "get_drive_backup_snapshot",
    title: "Leer copia para Drive",
    description: "Obtiene el texto exacto y el SHA-256 de la ficha identificada. Copia documentText íntegro a un documento de respaldo privado en la carpeta del paciente; no mezcles fichas ni sustituyas documentos clínicos preexistentes. La copia incluye metadatos, pero no los binarios de imágenes/PDF.",
    inputSchema: { type: "object", properties: { patientId: { type: "integer" } }, required: ["patientId"], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "confirm_drive_snapshot",
    title: "Confirmar copia en Drive",
    description: "Marca una ficha respaldada solo después de escribir y releer el documento privado en Drive y comprobar que su texto coincide íntegramente con documentText de get_drive_backup_snapshot. Verifica también la identidad/carpeta y usa el mismo digest; si la ficha cambió entretanto, la acción rechaza el acuse y hay que copiar la versión nueva. Nunca confirmes basándote solo en una carpeta o en la respuesta de escritura.",
    inputSchema: { type: "object", properties: { patientId: { type: "integer" }, fullName: { type: "string", description: "Nombre registrado o nombre dictado con todos los componentes conocidos; la ficha puede tener menos componentes" }, identityBirthDate: { type: "string", description: "Fecha de nacimiento para distinguir homónimos, si hace falta" }, identityRut: { type: "string", description: "RUT para distinguir homónimos, si hace falta" }, documentId: { type: "string", description: "ID real del documento comprobado" }, digest: { type: "string", description: "SHA-256 de la copia obtenida de la ficha" }, folderId: { type: "string", description: "ID de la carpeta comprobada, si corresponde" }, confirmed: { type: "boolean", description: "true solo tras comparar la lectura del documento con la copia exacta" } }, required: ["patientId", "fullName", "documentId", "digest", "confirmed"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "import_drive_records",
    title: "Importar fichas revisadas desde Drive",
    description: "Importa datos básicos de pacientes y evoluciones revisados en Google Drive. No importa odontogramas, periodontogramas, citas, presupuestos ni archivos de imágenes. Primero llama con confirmed=false para validar el lote y ver qué pacientes y evoluciones son nuevos o ya existen; no guarda nada en esa etapa. Después muestra el resumen al clínico y llama con confirmed=true solo si autorizó expresamente la importación. No inventes datos ni diagnósticos, conserva el texto clínico original, usa el ID real de cada carpeta y documento de Drive, y no unas pacientes por nombre. Si el resumen detecta otro registro con el mismo nombre, aclara si son personas distintas y marca confirmedDifferentPatient=true en esa ficha solo después de confirmarlo. El original de Drive no se modifica.",
    inputSchema: {
      type: "object",
      properties: {
        confirmed: { type: "boolean", description: "false para validar y mostrar la vista previa; true solo después de autorización expresa del clínico" },
        records: {
          type: "array",
          minItems: 1,
          maxItems: 20,
          items: {
            type: "object",
            properties: {
              name: { type: "string", description: "Nombre tal como aparece en el documento" },
              birthDate: { type: "string", description: "Fecha AAAA-MM-DD o cadena vacía si no está consignada" },
              reason: { type: "string", description: "Motivo de consulta original; cadena vacía si no está consignado" },
              history: { type: "string", description: "Antecedentes originales; cadena vacía si no están consignados" },
              allergies: { type: "string", description: "Alergias originales; cadena vacía si no están consignadas" },
              driveFolderId: { type: "string", description: "ID exacto de la carpeta de Drive de este paciente" },
              confirmedDifferentPatient: { type: "boolean", description: "true solo si se aclaró que una coincidencia de nombre es otra persona" },
              notes: {
                type: "array",
                minItems: 1,
                maxItems: 30,
                items: {
                  type: "object",
                  properties: {
                    clinicalDate: { type: "string", description: "Fecha clínica AAAA-MM-DD; cadena vacía si no está consignada en el documento. No usar la fecha de importación como fecha de atención." },
                    title: { type: "string" },
                    body: { type: "string", description: "Texto clínico revisado, sin añadir inferencias" },
                    sourceDocumentId: { type: "string", description: "ID exacto del documento de Drive" },
                  },
                  required: ["clinicalDate", "title", "body", "sourceDocumentId"],
                  additionalProperties: false,
                },
              },
            },
            required: ["name", "birthDate", "reason", "history", "allergies", "driveFolderId", "notes"],
            additionalProperties: false,
          },
        },
      },
      required: ["confirmed", "records"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  {
    name: "import_google_calendar_events",
    title: "Importar eventos de Google Calendar",
    description: "Importa o actualiza eventos profesionales confirmados desde Google Calendar en la agenda privada. Requiere la confirmación del profesional. Usa calendarId e ID exactos de Google; conserva el enlace de origen. Repetir la importación actualiza eventos reprogramados sin duplicarlos. No crea fichas de pacientes.",
    inputSchema: { type: "object", properties: {
      calendarId: { type: "string", description: "ID del calendario de origen devuelto por Google Calendar" },
      confirmed: { type: "boolean", description: "true después de que el profesional haya pedido importar su agenda" },
      events: { type: "array", minItems: 1, maxItems: 250, items: { type: "object", properties: {
        eventId: { type: "string" }, title: { type: "string" }, startAt: { type: "string", description: "Fecha/hora ISO 8601 con zona u offset" }, endAt: { type: "string", description: "Fecha/hora ISO 8601 con zona u offset" },
        sourceTimeZone: { type: "string" }, htmlLink: { type: "string" }, status: { type: "string", enum: ["confirmed", "tentative", "cancelled"] }, allDay: { type: "boolean" }, updatedAt: { type: "string" }
      }, required: ["eventId", "title", "startAt", "endAt"], additionalProperties: false } }
    }, required: ["calendarId", "confirmed", "events"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },];

function rpcResponse(id: JsonRpcId, result: unknown) {
  return Response.json({ jsonrpc: "2.0", id, result }, { headers: { "Cache-Control": "no-store" } });
}

function rpcError(id: JsonRpcId, code: number, message: string) {
  return Response.json({ jsonrpc: "2.0", id, error: { code, message } }, { headers: { "Cache-Control": "no-store" } });
}

function toolResult(value: unknown, isError = false) {
  const content = [{ type: "text", text: JSON.stringify(value) }];
  return { content, structuredContent: value, ...(isError ? { isError: true } : {}) };
}

const safeArgs = (value: unknown): JsonRecord | null => value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;

async function findPatient(ownerId: string, queryInput: unknown) {
  const query = string(queryInput, 120);
  if (query.length < 3) return { foundInApp: false, needsMoreSpecificQuery: true, message: "Indica el RUT o al menos tres caracteres del nombre." };
  const db = getDb();
  const rutLike = /[0-9]/.test(query) && /^[0-9kK.\-\s]+$/.test(query);
  let matches;
  if (rutLike) {
    const rut = cleanRut(query);
    if (rut.length < 7) return { foundInApp: false, needsMoreSpecificQuery: true, message: "Indica el RUT completo para buscar con precisión." };
    if (!validRut(rut)) return { foundInApp: false, invalidQuery: "RUT", message: "El RUT no valida. Confírmalo antes de buscar en Drive o crear una ficha." };
    matches = await db.select(patientFields).from(patients).where(and(eq(patients.ownerId, ownerId), eq(patients.rut, rut))).limit(10);
  } else {
    const term = query.replace(/[%_\\]/g, " ").replace(/\s+/g, " ").trim();
    if (term.length < 3) return { foundInApp: false, needsMoreSpecificQuery: true, message: "Indica un nombre más completo." };
    const namedPatients = await db.select(patientFields).from(patients).where(eq(patients.ownerId, ownerId)).limit(10000);
    const normalizedTerm = normalizePatientName(term);
    const bestMatches = bestStoredNameMatches(term, namedPatients);
    matches = (bestMatches.length ? bestMatches : namedPatients.filter(patient => normalizePatientName(patient.name).includes(normalizedTerm))).slice(0, 10);
  }
  if (!matches.length) return { foundInApp: false, matchCount: 0, matches: [], nextStep: "Busca el nombre o RUT en Google Drive antes de crear una ficha nueva." };
  const ids = matches.map(patient => patient.id);
  const history = await db.select({ patientId: evolutions.patientId, clinicalDate: evolutions.clinicalDate }).from(evolutions).where(and(eq(evolutions.ownerId, ownerId), inArray(evolutions.patientId, ids))).orderBy(desc(evolutions.clinicalDate));
  const historyByPatient = new Map<number, { count: number; latestDate: string | null }>();
  for (const entry of history) {
    const current = historyByPatient.get(entry.patientId) ?? { count: 0, latestDate: null };
    current.count++;
    current.latestDate ??= entry.clinicalDate;
    historyByPatient.set(entry.patientId, current);
  }
  return {
    foundInApp: true,
    matchCount: matches.length,
    needsClarification: matches.length > 1,
    matches: matches.map(patient => ({ ...patient, rut: patient.rut || "", evolutionCount: historyByPatient.get(patient.id)?.count ?? 0, latestEvolutionDate: historyByPatient.get(patient.id)?.latestDate ?? null })),
  };
}

async function getPatientRecord(ownerId: string, patientIdInput: unknown) {
  const patientId = Number(patientIdInput);
  if (!Number.isSafeInteger(patientId) || patientId <= 0) return { found: false, error: "El ID de paciente no es válido." };
  const db = getDb();
  const [patient] = await db.select(patientFields).from(patients).where(and(eq(patients.id, patientId), eq(patients.ownerId, ownerId))).limit(1);
  if (!patient) return { found: false, error: "No encontré esa ficha en Gestión Dental." };
  const history = await db.select({ id: evolutions.id, clinicalDate: evolutions.clinicalDate, recordedAt: evolutions.recordedAt, title: evolutions.title, body: evolutions.body, sourceDocumentId: evolutions.sourceDocumentId, backupStatus: evolutions.backupStatus }).from(evolutions).where(and(eq(evolutions.ownerId, ownerId), eq(evolutions.patientId, patientId))).orderBy(desc(evolutions.clinicalDate), desc(evolutions.recordedAt)).limit(10);
  return { found: true, patient: { ...patient, rut: patient.rut || "" }, evolutions: history };
}

async function createPatient(ownerId: string, args: JsonRecord) {
  if (args.confirmed !== true) return { created: false, needsConfirmation: true, message: "Confirma verbalmente con el clínico antes de crear la ficha." };
  if (args.driveSearchChecked !== true) return { created: false, needsDriveCheck: true, message: "Busca primero el nombre o RUT en Google Drive y confirma si hay una ficha existente para vincularla." };
  const name = string(args.name, 180), birthDate = string(args.birthDate, 10), rutRaw = string(args.rut, 20), phone = string(args.phone, 24), email = string(args.email, 254), reason = string(args.reason, 240) || "Evaluación", driveFolderId = string(args.driveFolderId, 200);
  const tooLongFields = [typeof args.name === "string" && args.name.trim().length > 180 ? "Nombre completo" : "", typeof args.birthDate === "string" && args.birthDate.trim().length > 10 ? "Fecha de nacimiento" : "", typeof args.rut === "string" && args.rut.trim().length > 20 ? "RUT" : "", typeof args.phone === "string" && args.phone.trim().length > 24 ? "Teléfono" : "", typeof args.email === "string" && args.email.trim().length > 254 ? "Correo electrónico" : "", typeof args.reason === "string" && args.reason.trim().length > 240 ? "Motivo de consulta" : "", typeof args.driveFolderId === "string" && args.driveFolderId.trim().length > 200 ? "Carpeta de Drive" : ""].filter(Boolean);
  if (tooLongFields.length) return { created: false, invalidFields: tooLongFields, message: "Uno de los datos excede el largo permitido." };
  const missingFields = [!hasFourNameParts(name) ? "dos nombres y dos apellidos" : "", !birthDate ? "Fecha de nacimiento" : ""].filter(Boolean);
  if (missingFields.length) return { created: false, missingFields, nextQuestion: `Pregunta por ${missingFields[0].toLowerCase()}.` };
  if (!validDate(birthDate) || dateIsFuture(birthDate) || Number(birthDate.slice(0, 4)) < Number(dateInChile().slice(0, 4)) - 125) return { created: false, invalidFields: ["Fecha de nacimiento"], message: "Revisa la fecha antes de guardar." };
  if (rutRaw && !validRut(rutRaw)) return { created: false, invalidFields: ["RUT"], message: "El RUT o dígito verificador no es válido." };
  if (!validPhone(phone)) return { created: false, invalidFields: ["Teléfono"], message: "Revisa el teléfono antes de guardar." };
  if (!validEmail(email)) return { created: false, invalidFields: ["Correo electrónico"], message: "Revisa el correo electrónico antes de guardar." };
  if (driveFolderId && !driveIdPattern.test(driveFolderId)) return { created: false, invalidFields: ["Carpeta de Drive"], message: "El ID de carpeta no tiene un formato válido." };
  const db = getDb(), rut = rutRaw ? cleanRut(rutRaw) : null;
  if (rut) {
    const [existing] = await db.select({ id: patients.id, name: patients.name, birthDate: patients.birthDate, rut: patients.rut }).from(patients).where(and(eq(patients.ownerId, ownerId), eq(patients.rut, rut))).limit(1);
    if (existing) return { created: false, duplicate: true, existingPatient: existing, message: "Ya existe una ficha con ese RUT. Ábrela y agrega la evolución si corresponde." };
  }
  const existingNames = await db.select({ id: patients.id, name: patients.name, birthDate: patients.birthDate, rut: patients.rut }).from(patients).where(eq(patients.ownerId, ownerId)).limit(10000);
  const exactNames = existingNames.filter(candidate => normalizePatientName(candidate.name) === normalizePatientName(name));
  const sameName = exactNames;
  if (sameName.length && !rut && args.confirmDifferentPatient !== true) return { created: false, needsClarification: true, possibleDuplicates: sameName, message: "Ya hay una ficha con el mismo nombre. Confirma si se trata de otra persona antes de crear." };
  const timestamp = now();
  const [patient] = await db.insert(patients).values({ ownerId, name, birthDate, rut, phone, email, reason, status: "Evaluación", allergies: "Sin registrar", history: "Sin registrar", driveFolderId: driveFolderId || null, createdAt: timestamp, updatedAt: timestamp }).returning({ id: patients.id, name: patients.name, birthDate: patients.birthDate, rut: patients.rut, phone: patients.phone, email: patients.email, reason: patients.reason, status: patients.status, driveFolderId: patients.driveFolderId });
  return { created: true, patient: { ...patient, rut: patient.rut || "" }, nextStep: "Si corresponde, crea o vincula el respaldo de Drive. Después agrega la evolución de esta atención." };
}

async function updatePatientContact(ownerId: string, args: JsonRecord) {
  if (args.confirmed !== true) return { saved: false, needsConfirmation: true, message: "Confirma la actualización de contacto antes de guardarla." };
  const patientId = Number(args.patientId);
  const hasRut = Object.prototype.hasOwnProperty.call(args, "rut");
  const hasPhone = Object.prototype.hasOwnProperty.call(args, "phone");
  const hasEmail = Object.prototype.hasOwnProperty.call(args, "email");
  if (!Number.isSafeInteger(patientId) || patientId <= 0) return { saved: false, missingFields: ["Paciente"] };
  if (!hasRut && !hasPhone && !hasEmail) return { saved: false, missingFields: ["RUN / RUT, teléfono o correo electrónico"] };
  if (hasRut && (typeof args.rut !== "string" || args.rut.trim().length > 20)) return { saved: false, invalidFields: ["RUN / RUT"] };
  if (hasPhone && (typeof args.phone !== "string" || args.phone.trim().length > 24)) return { saved: false, invalidFields: ["Teléfono"] };
  if (hasEmail && (typeof args.email !== "string" || args.email.trim().length > 254)) return { saved: false, invalidFields: ["Correo electrónico"] };
  const rutRaw = hasRut ? string(args.rut, 20) : undefined;
  const phone = hasPhone ? string(args.phone, 24) : undefined;
  const email = hasEmail ? string(args.email, 254) : undefined;
  if (rutRaw && !validRut(rutRaw)) return { saved: false, invalidFields: ["RUN / RUT"], message: "Revisa el RUN / RUT y su dígito verificador." };
  const rut = rutRaw ? cleanRut(rutRaw) : null;
  if (phone !== undefined && !validPhone(phone)) return { saved: false, invalidFields: ["Teléfono"], message: "Revisa el teléfono antes de guardar." };
  if (email !== undefined && !validEmail(email)) return { saved: false, invalidFields: ["Correo electrónico"], message: "Revisa el correo electrónico antes de guardar." };

  const db = getDb();
  const [existing] = await db.select({ id: patients.id, name: patients.name, rut: patients.rut, phone: patients.phone, email: patients.email })
    .from(patients).where(and(eq(patients.id, patientId), eq(patients.ownerId, ownerId))).limit(1);
  if (!existing) return { saved: false, error: "No encontré esa ficha en Gestión Dental." };
  const identityError = await verifyWriteIdentity(ownerId, patientId, existing.name, args, db);
  if (identityError) return { saved: false, ...identityError, patient: { id: existing.id, name: existing.name } };
  if (rut) {
    const [duplicate] = await db.select({ id: patients.id, name: patients.name }).from(patients)
      .where(and(eq(patients.ownerId, ownerId), eq(patients.rut, rut), ne(patients.id, patientId))).limit(1);
    if (duplicate) return { saved: false, duplicateRut: true, existingPatient: duplicate, message: "Ya existe otra ficha con ese RUN / RUT." };
  }
  const changes: Record<string, unknown> = { updatedAt: now() };
  if (hasRut) changes.rut = rut;
  if (phone !== undefined) changes.phone = phone;
  if (email !== undefined) changes.email = email;
  await db.update(patients).set(changes).where(and(eq(patients.id, patientId), eq(patients.ownerId, ownerId)));
  const [verified] = await db.select({ id: patients.id, name: patients.name, rut: patients.rut, phone: patients.phone, email: patients.email })
    .from(patients).where(and(eq(patients.id, patientId), eq(patients.ownerId, ownerId))).limit(1);
  if (!verified || (hasRut && verified.rut !== rut) || (phone !== undefined && verified.phone !== phone) || (email !== undefined && verified.email !== email)) {
    return { saved: false, verificationFailed: true, patient: { id: existing.id, name: existing.name }, message: "No pude confirmar el contacto al releer la ficha." };
  }
  return { saved: true, verified: true, patient: verified, updatedFields: [hasRut ? "rut" : "", phone !== undefined ? "phone" : "", email !== undefined ? "email" : ""].filter(Boolean) };
}

async function appendEvolution(ownerId: string, args: JsonRecord) {
  if (args.confirmed !== true) return { saved: false, needsConfirmation: true, message: "Confirma verbalmente con el clínico antes de guardar la evolución." };
  const patientId = Number(args.patientId), body = string(args.body, 30000), clinicalDateInput = string(args.clinicalDate, 10), clinicalDate = clinicalDateInput || dateInChile(), title = string(args.title, 180) || "Evolución clínica", sourceDocumentId = string(args.sourceDocumentId, 200), requestIdInput = string(args.requestId, 80);
  const tooLongFields = [typeof args.body === "string" && args.body.trim().length > 30000 ? "Registro clínico" : "", typeof args.title === "string" && args.title.trim().length > 180 ? "Título" : ""].filter(Boolean);
  if (tooLongFields.length) return { saved: false, invalidFields: tooLongFields, message: "Uno de los datos excede el largo permitido." };
  const missingFields = [!Number.isSafeInteger(patientId) || patientId <= 0 ? "Paciente" : "", !body ? "Registro clínico" : ""].filter(Boolean);
  if (missingFields.length) return { saved: false, missingFields, nextQuestion: `Completa ${missingFields[0].toLowerCase()}.` };
  if (!validDate(clinicalDate) || dateIsFuture(clinicalDate)) return { saved: false, invalidFields: ["Fecha de atención"], message: "La fecha de atención no es válida o es futura." };
  if (sourceDocumentId && !driveIdPattern.test(sourceDocumentId)) return { saved: false, invalidFields: ["Documento de Drive"], message: "El ID del documento de Drive no tiene un formato válido." };
  const db = getDb();
  const [patient] = await db.select({ id: patients.id, name: patients.name }).from(patients).where(and(eq(patients.id, patientId), eq(patients.ownerId, ownerId))).limit(1);
  if (!patient) return { saved: false, error: "No encontré esa ficha. Busca al paciente antes de guardar." };
  const identityError = await verifyWriteIdentity(ownerId, patientId, patient.name, args, db);
  if (identityError) return { saved: false, ...identityError, patient };
  const requestId = requestIdInput ? `mcp:${requestIdInput}` : `mcp:${patientId}:${clinicalDate}:${await noteDigest(body)}`;
  const [existing] = await db.select({ id: evolutions.id, patientId: evolutions.patientId, clinicalDate: evolutions.clinicalDate, title: evolutions.title, sourceDocumentId: evolutions.sourceDocumentId, backupStatus: evolutions.backupStatus }).from(evolutions).where(and(eq(evolutions.ownerId, ownerId), eq(evolutions.requestId, requestId))).limit(1);
  if (existing) {
    if (existing.patientId !== patientId) return { saved: false, error: "Esta solicitud ya está asociada a otra ficha." };
    const savedEvolution = sourceDocumentId ? await db.update(evolutions).set({ sourceDocumentId, backupStatus: "source_in_drive" }).where(and(eq(evolutions.id, existing.id), eq(evolutions.ownerId, ownerId))).returning({ id: evolutions.id, patientId: evolutions.patientId, clinicalDate: evolutions.clinicalDate, title: evolutions.title, sourceDocumentId: evolutions.sourceDocumentId, backupStatus: evolutions.backupStatus }) : [existing];
    const note = savedEvolution[0];
    return { saved: true, alreadySaved: true, patient, evolution: note, backupPending: note.backupStatus === "not_configured" };
  }
  const timestamp = now();
  const [note] = await db.insert(evolutions).values({ ownerId, patientId, clinicalDate, recordedAt: timestamp, title, body, sourceDocumentId: sourceDocumentId || null, requestId, backupStatus: sourceDocumentId ? "source_in_drive" : "not_configured" }).returning({ id: evolutions.id, patientId: evolutions.patientId, clinicalDate: evolutions.clinicalDate, title: evolutions.title, sourceDocumentId: evolutions.sourceDocumentId, backupStatus: evolutions.backupStatus });
  let chart;
  try { chart = await syncInstalledImplants(ownerId, patientId, body, timestamp); }
  catch { chart = { updatedTeeth: [], warning: "La evolución se guardó, pero no se verificó la actualización del odontograma." }; }
  return { saved: true, alreadySaved: false, patient, evolution: note, chart, backupPending: note.backupStatus === "not_configured" };
}

async function evolvePatientByName(ownerId: string, args: JsonRecord) {
  const name = string(args.name, 180), rutInput = string(args.rut, 20), birthDate = string(args.birthDate, 10);
  if (typeof args.name !== "string" || args.name.trim().length > 180 || name.length < 3) return { saved: false, invalidFields: ["Nombre completo"] };
  if (normalizePatientName(name).split(/\s+/).filter(Boolean).length < 2) return { saved: false, needsIdentityCompletion: true, message: "Indica al menos dos componentes del nombre; si conoces los dos nombres y los dos apellidos, inclúyelos." };
  if (rutInput && (!validRut(rutInput) || (typeof args.rut === "string" && args.rut.trim().length > 20))) return { saved: false, invalidFields: ["RUT"] };
  if (birthDate && (!validDate(birthDate) || (typeof args.birthDate === "string" && args.birthDate.trim().length > 10))) return { saved: false, invalidFields: ["Fecha de nacimiento"] };
  const db = getDb();
  const candidates: { id: number; name: string; rut: string | null; birthDate: string }[] = [];
  let lastId = 0;
  // Page by the primary key so an owner with many fichas cannot silently miss a homonym.
  while (true) {
    const page = await db.select({ id: patients.id, name: patients.name, rut: patients.rut, birthDate: patients.birthDate })
      .from(patients).where(and(eq(patients.ownerId, ownerId), gt(patients.id, lastId))).orderBy(patients.id).limit(500);
    candidates.push(...page);
    if (page.length < 500) break;
    lastId = page[page.length - 1].id;
  }
  const compatibleNames = candidates.filter(patient => storedNameMatchScore(name, patient.name) > 0);
  const identifiedNames = compatibleNames.filter(patient => (!rutInput || patient.rut === cleanRut(rutInput)) && (!birthDate || patient.birthDate === birthDate));
  const matches = bestStoredNameMatches(name, (rutInput || birthDate) ? identifiedNames : compatibleNames);
  if (!matches.length) return { saved: false, found: false, message: "No hay una ficha con esa identidad. Revisa el nombre o identificador; no se creó una ficha." };
  if (matches.length > 1) return { saved: false, needsClarification: true, matches: matches.map(({ id, name, birthDate, rut }) => ({ id, name, birthDate, rut: rut || "" })), message: "Hay más de una ficha coincidente. Indica RUT o fecha de nacimiento antes de guardar." };
  const result = await appendEvolution(ownerId, { ...args, fullName: name, identityRut: rutInput, identityBirthDate: birthDate, patientId: matches[0].id, confirmed: true });
  if (!("evolution" in result) || !result.saved || !result.evolution) return result;
  const [verified] = await db.select({ id: evolutions.id, patientId: evolutions.patientId, clinicalDate: evolutions.clinicalDate, recordedAt: evolutions.recordedAt, title: evolutions.title, body: evolutions.body, backupStatus: evolutions.backupStatus })
    .from(evolutions).where(and(eq(evolutions.ownerId, ownerId), eq(evolutions.patientId, matches[0].id), eq(evolutions.id, result.evolution.id))).limit(1);
  if (!verified || verified.body !== string(args.body, 30000) || verified.title !== (string(args.title, 180) || "Evolución clínica") || verified.clinicalDate !== (string(args.clinicalDate, 10) || dateInChile())) {
    return { saved: false, verificationFailed: true, patient: matches[0], evolutionId: result.evolution.id, message: "La evolución no coincide con la solicitud al releerla; inspecciona la ficha antes de reintentar." };
  }
  return { ...result, verified: true, evolution: verified };
}

async function setToothStatus(ownerId: string, args: JsonRecord) {
  if (args.confirmed !== true) return { saved: false, needsConfirmation: true, message: "Confirma verbalmente con el clínico antes de modificar el odontograma." };
  const patientId = Number(args.patientId), tooth = Number(args.toothFDI), status = string(args.status, 48);
  const allowedTeeth = new Set([11,12,13,14,15,16,17,18,21,22,23,24,25,26,27,28,31,32,33,34,35,36,37,38,41,42,43,44,45,46,47,48,51,52,53,54,55,61,62,63,64,65,71,72,73,74,75,81,82,83,84,85]);
  const statuses = ["Sin hallazgos", "Implante", "Corona", "Ausente", "Indicación de exodoncia", "Resto radicular con endodoncia"];
  if (!Number.isSafeInteger(patientId) || patientId <= 0) return { saved: false, missingFields: ["Paciente"] };
  if (!Number.isSafeInteger(tooth) || !allowedTeeth.has(tooth) || !statuses.includes(status)) return { saved: false, invalidFields: ["Pieza o estado general"] };
  const db = getDb();
  const [patient] = await db.select({ id: patients.id, name: patients.name }).from(patients).where(and(eq(patients.id, patientId), eq(patients.ownerId, ownerId))).limit(1);
  if (!patient) return { saved: false, error: "No encontré esa ficha. Busca al paciente antes de guardar." };
  const identityError = await verifyWriteIdentity(ownerId, patientId, patient.name, args, db);
  if (identityError) return { saved: false, ...identityError, patient };
  const [old] = await db.select().from(toothStatuses).where(and(eq(toothStatuses.ownerId, ownerId), eq(toothStatuses.patientId, patientId))).limit(1);
  let raw: unknown = {};
  try { raw = old ? JSON.parse(old.data) : {}; } catch { return { saved: false, error: "El odontograma existente no se pudo leer con seguridad; no se modificó." }; }
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as JsonRecord : {};
  const teeth = source.teeth && typeof source.teeth === "object" && !Array.isArray(source.teeth) ? { ...(source.teeth as Record<string, unknown>) } : {};
  const surfaces = source.surfaces && typeof source.surfaces === "object" && !Array.isArray(source.surfaces) ? source.surfaces : {};
  const missingReason = source.missingReason && typeof source.missingReason === "object" && !Array.isArray(source.missingReason) ? source.missingReason : {};
  teeth[String(tooth)] = status;
  const crowns = source.crowns && typeof source.crowns === "object" && !Array.isArray(source.crowns) ? { ...(source.crowns as Record<string, unknown>) } : {};
  if (status !== "Corona") delete crowns[String(tooth)];
  const data = { teeth, surfaces, missingReason, crowns };
  const savedAt = now();
  await db.insert(toothStatuses).values({ ownerId, patientId, data: JSON.stringify(data), updatedAt: savedAt }).onConflictDoUpdate({ target: toothStatuses.patientId, set: { data: JSON.stringify(data), updatedAt: savedAt } });
  return { saved: true, patientId, toothFDI: tooth, toothFDILabel: formatFdi(tooth), status, odontogram: data };
}

async function linkDriveBackup(ownerId: string, args: JsonRecord) {
  if (args.confirmed !== true) return { linked: false, needsConfirmation: true, message: "Confirma la actualización del respaldo después de verificar el resultado de Drive." };
  const patientId = Number(args.patientId), evolutionId = args.evolutionId === undefined ? null : Number(args.evolutionId), sourceDocumentId = string(args.sourceDocumentId, 200), driveFolderId = string(args.driveFolderId, 200);
  if (!Number.isSafeInteger(patientId) || patientId <= 0) return { linked: false, missingFields: ["Paciente"] };
  if (!sourceDocumentId && !driveFolderId) return { linked: false, missingFields: ["ID del documento o carpeta de Drive"] };
  if (sourceDocumentId && !driveIdPattern.test(sourceDocumentId)) return { linked: false, invalidFields: ["Documento de Drive"] };
  if (driveFolderId && !driveIdPattern.test(driveFolderId)) return { linked: false, invalidFields: ["Carpeta de Drive"] };
  const db = getDb();
  const [patient] = await db.select({ id: patients.id, name: patients.name, driveFolderId: patients.driveFolderId }).from(patients).where(and(eq(patients.id, patientId), eq(patients.ownerId, ownerId))).limit(1);
  if (!patient) return { linked: false, error: "No encontré esa ficha." };
  const identityError = await verifyWriteIdentity(ownerId, patientId, patient.name, args, db);
  if (identityError) return { linked: false, ...identityError };
  let linkedEvolutionId: number | null = null;
  if (sourceDocumentId) {
    if (!Number.isSafeInteger(evolutionId) || !evolutionId || !driveIdPattern.test(sourceDocumentId)) return { linked: false, missingFields: ["ID de evolución"] };
    const [existingNote] = await db.select({ id: evolutions.id }).from(evolutions).where(and(eq(evolutions.id, evolutionId), eq(evolutions.patientId, patientId), eq(evolutions.ownerId, ownerId))).limit(1);
    if (!existingNote) return { linked: false, error: "No encontré esa evolución dentro de la ficha indicada." };
    const [note] = await db.update(evolutions).set({ sourceDocumentId, backupStatus: "source_in_drive" }).where(and(eq(evolutions.id, evolutionId), eq(evolutions.patientId, patientId), eq(evolutions.ownerId, ownerId))).returning({ id: evolutions.id });
    linkedEvolutionId = note.id;
  }
  if (driveFolderId) await db.update(patients).set({ driveFolderId, updatedAt: now() }).where(and(eq(patients.id, patientId), eq(patients.ownerId, ownerId)));
  return { linked: true, patientId, evolutionId: linkedEvolutionId, driveFolderId: driveFolderId || patient.driveFolderId, sourceDocumentId: sourceDocumentId || null };
}

async function noteDigest(body: string) {
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
  return Array.from(new Uint8Array(hash)).map(value => value.toString(16).padStart(2, "0")).join("").slice(0, 24);
}

async function callTool(ownerId: string, name: unknown, args: unknown) {
  const input = safeArgs(args);
  if (!input) throw new Error("Los argumentos de la herramienta deben ser un objeto.");
  if (name === "find_patient") return findPatient(ownerId, input.query);
  if (name === "get_patient_record") return getPatientRecord(ownerId, input.patientId);
  if (name === "create_patient") return createPatient(ownerId, input);
  if (name === "update_patient_contact") return updatePatientContact(ownerId, input);
  if (name === "append_clinical_evolution") return appendEvolution(ownerId, input);
  if (name === "evolve_patient_by_name") return evolvePatientByName(ownerId, input);
  if (name === "set_tooth_status") return setToothStatus(ownerId, input);
  if (name === "link_drive_backup") return linkDriveBackup(ownerId, input);
  if (name === "list_drive_backup_queue") {
    const cursor = input.afterPatientId === undefined ? 0 : Number(input.afterPatientId);
    if (!Number.isSafeInteger(cursor) || cursor < 0) return { error: "Cursor inválido." };
    return listDriveBackupQueue(ownerId, cursor);
  }
  if (name === "get_drive_backup_snapshot") {
    const patientId = Number(input.patientId);
    if (!Number.isSafeInteger(patientId) || patientId <= 0) return { found: false, error: "Ficha inválida." };
    return await getDriveSnapshot(ownerId, patientId) ?? { found: false };
  }
  if (name === "confirm_drive_snapshot") {
    const patientId = Number(input.patientId), documentId = string(input.documentId, 200), digest = string(input.digest, 64), folderId = string(input.folderId, 200);
    if (input.confirmed !== true) return { saved: false, needsVerification: true };
    if (!Number.isSafeInteger(patientId) || patientId <= 0 || !driveIdPattern.test(documentId) || !/^[a-f0-9]{64}$/.test(digest) || (folderId && !driveIdPattern.test(folderId))) return { saved: false, invalidFields: ["Ficha, documento, huella o carpeta"] };
    const db = getDb();
    const [patient] = await db.select({ name: patients.name }).from(patients).where(and(eq(patients.id, patientId), eq(patients.ownerId, ownerId))).limit(1);
    if (!patient) return { saved: false, identityMismatch: true, message: "No se encontró la ficha indicada." };
    const identityError = await verifyWriteIdentity(ownerId, patientId, patient.name, input, db);
    if (identityError) return { saved: false, ...identityError };
    return confirmDriveSnapshot(ownerId, patientId, documentId, digest, folderId || null);
  }
  if (name === "import_google_calendar_events") {
    if (input.confirmed !== true) return { imported: false, needsConfirmation: true };
    const calendarId = string(input.calendarId, 512), rawEvents = input.events;
    if (!calendarId || !Array.isArray(rawEvents) || rawEvents.length < 1 || rawEvents.length > 250) return { imported: false, invalidFields: ["Calendario o eventos"] };
    const timestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;
    const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
    const prepared: Array<{ eventId: string; title: string; startAt: string; endAt: string; sourceTimeZone: string; htmlLink: string | null; status: string; allDay: boolean; sourceUpdatedAt: string | null }> = [];
    const ids = new Set<string>();
    for (const raw of rawEvents) {
      const event = safeArgs(raw); if (!event) return { imported: false, invalidFields: ["Evento"] };
      const eventId = string(event.eventId, 512), title = string(event.title, 500), startRaw = string(event.startAt, 64), endRaw = string(event.endAt, 64), sourceTimeZone = string(event.sourceTimeZone, 100) || "America/Santiago", htmlLink = string(event.htmlLink, 2000), status = event.status === undefined ? "confirmed" : string(event.status, 20), allDay = event.allDay === true, updatedAt = string(event.updatedAt, 64);
      const validBoundaries = allDay ? dayPattern.test(startRaw) && dayPattern.test(endRaw) : timestampPattern.test(startRaw) && timestampPattern.test(endRaw);
      const startDate = allDay && dayPattern.test(startRaw) ? new Date(`${startRaw}T12:00:00.000Z`) : new Date(startRaw), endDate = allDay && dayPattern.test(endRaw) ? new Date(`${endRaw}T12:00:00.000Z`) : new Date(endRaw);
      let validGoogleLink = true; if (htmlLink) { try { const link = new URL(htmlLink); validGoogleLink = link.protocol === "https:" && ["calendar.google.com", "www.google.com"].includes(link.hostname); } catch { validGoogleLink = false; } }
      if (!eventId || ids.has(eventId) || !title || !validBoundaries || Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime()) || startDate >= endDate || !["confirmed", "tentative", "cancelled"].includes(status) || (htmlLink && !validGoogleLink) || (updatedAt && !timestampPattern.test(updatedAt))) return { imported: false, invalidFields: ["ID, título, estado, fechas o enlace de Google Calendar"] };
      ids.add(eventId);
      prepared.push({ eventId, title, startAt: startDate.toISOString(), endAt: endDate.toISOString(), sourceTimeZone, htmlLink: htmlLink || null, status, allDay, sourceUpdatedAt: updatedAt ? new Date(updatedAt).toISOString() : null });
    }
    const db = getDb(), importedAt = now(); let added = 0, updated = 0, unchanged = 0;
    for (const event of prepared) {
      const [existing] = await db.select({ id: calendarEvents.id, title: calendarEvents.title, startAt: calendarEvents.startAt, endAt: calendarEvents.endAt, sourceTimeZone: calendarEvents.sourceTimeZone, htmlLink: calendarEvents.htmlLink, status: calendarEvents.status, allDay: calendarEvents.allDay, sourceUpdatedAt: calendarEvents.sourceUpdatedAt }).from(calendarEvents).where(and(eq(calendarEvents.ownerId, ownerId), eq(calendarEvents.calendarId, calendarId), eq(calendarEvents.googleEventId, event.eventId))).limit(1);
      await db.insert(calendarEvents).values({ ownerId, calendarId, googleEventId: event.eventId, title: event.title, startAt: event.startAt, endAt: event.endAt, sourceTimeZone: event.sourceTimeZone, htmlLink: event.htmlLink, status: event.status, allDay: event.allDay, importedAt, sourceUpdatedAt: event.sourceUpdatedAt }).onConflictDoUpdate({ target: [calendarEvents.ownerId, calendarEvents.calendarId, calendarEvents.googleEventId], set: { title: event.title, startAt: event.startAt, endAt: event.endAt, sourceTimeZone: event.sourceTimeZone, htmlLink: event.htmlLink, status: event.status, allDay: event.allDay, importedAt, sourceUpdatedAt: event.sourceUpdatedAt } });
      if (!existing) added++; else if (existing.title !== event.title || existing.startAt !== event.startAt || existing.endAt !== event.endAt || existing.sourceTimeZone !== event.sourceTimeZone || existing.htmlLink !== event.htmlLink || existing.status !== event.status || existing.allDay !== event.allDay || existing.sourceUpdatedAt !== event.sourceUpdatedAt) updated++; else unchanged++;
    }
    const persisted = await db.select({ googleEventId: calendarEvents.googleEventId, title: calendarEvents.title, startAt: calendarEvents.startAt, endAt: calendarEvents.endAt, status: calendarEvents.status }).from(calendarEvents).where(and(eq(calendarEvents.ownerId, ownerId), eq(calendarEvents.calendarId, calendarId), inArray(calendarEvents.googleEventId, prepared.map(event => event.eventId))));
    if (persisted.length !== prepared.length || prepared.some(event => !persisted.some(row => row.googleEventId === event.eventId && row.title === event.title && row.startAt === event.startAt && row.endAt === event.endAt && row.status === event.status))) return { imported: false, verificationFailed: true, message: "No se pudieron releer todos los eventos importados." };
    return { imported: true, verified: true, added, updated, unchanged, total: prepared.length };
  }  if (name === "import_drive_records") return runDriveRecordImport(ownerId, input.records, input.confirmed === true);
  throw new Error("Herramienta no reconocida.");
}

export async function POST(request: Request) {
  let body: JsonRecord;
  try {
    const raw = await request.text();
    if (raw.length > 350_000) return rpcError(null, -32600, "La solicitud excede el tamaño permitido.");
    const parsed: unknown = JSON.parse(raw);
    const record = safeArgs(parsed);
    if (!record) return rpcError(null, -32600, "La solicitud JSON-RPC no es válida.");
    body = record;
  } catch {
    return rpcError(null, -32700, "No se pudo leer el JSON enviado.");
  }
  const id = (typeof body.id === "string" || typeof body.id === "number" || body.id === null) ? body.id as JsonRpcId : null;
  if (body.jsonrpc !== "2.0" || typeof body.method !== "string") return rpcError(id, -32600, "Solicitud JSON-RPC no válida.");
  if (body.method === "server/discover") return rpcResponse(id, { supportedVersions: ["2026-07-28"], capabilities: { tools: {} } });
  if (body.method === "tools/list") return rpcResponse(id, { tools });
  if (body.method !== "tools/call") return rpcError(id, -32601, "Método JSON-RPC no reconocido.");
  const idHeader = request.headers.get("oai-authenticated-user-id");
  if (!idHeader) return rpcError(id, -32001, "La solicitud no incluye una identidad autenticada de ChatGPT.");
  const params = safeArgs(body.params);
  if (!params || typeof params.name !== "string") return rpcError(id, -32602, "Falta el nombre de la herramienta.");
  try {
    const result = await callTool(idHeader, params.name, params.arguments);
    return rpcResponse(id, toolResult(result));
  } catch (e) {
    const message = e instanceof ClinicalImportError ? e.message : "No se pudo completar la operación. Revisa la conexión y vuelve a intentar.";
    return rpcResponse(id, toolResult({ success: false, error: message }, true));
  }
}
