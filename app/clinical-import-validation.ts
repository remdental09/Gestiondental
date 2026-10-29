type DriveNote = { clinicalDate: string; title: string; body: string; sourceDocumentId: string };
type DriveRecord = {
  name: string;
  birthDate: string;
  reason: string;
  history: string;
  allergies: string;
  driveFolderId: string;
  confirmedDifferentPatient: boolean;
  notes: DriveNote[];
};

export type RecordPreview = {
  name: string;
  patientAlreadyLinked: boolean;
  linkedPatientName: string | null;
  notesToCreate: number;
  notesAlreadyPresent: number;
  sameNameMatches: number;
};

export class ClinicalImportError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
    this.name = "ClinicalImportError";
  }
}

const text = (value: unknown, max: number, field: string, { optional = false } = {}) => {
  if (value === undefined || value === null) {
    if (optional) return "";
    throw new ClinicalImportError(`Falta ${field}.`);
  }
  if (typeof value !== "string") throw new ClinicalImportError(`${field} debe ser texto.`);
  if (value.length > max) throw new ClinicalImportError(`${field} excede el largo permitido.`);
  return value;
};

const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const driveIdPattern = /^[A-Za-z0-9_-]{15,100}$/;
const hasFourNameParts = (value: string) => value.trim().split(/\s+/).filter(Boolean).length >= 4;
export const normalizeName = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export const requestIdFor = (note: DriveNote) => `drive:${note.sourceDocumentId}:${note.clinicalDate}`;

export function parseRecords(input: unknown): DriveRecord[] {
  if (!Array.isArray(input) || input.length < 1 || input.length > 20 || JSON.stringify(input).length > 250000) {
    throw new ClinicalImportError("Lote inválido: incluye entre 1 y 20 fichas y hasta 250 KB.");
  }

  const folders = new Set<string>();
  const requestIds = new Set<string>();
  return input.map((item, recordIndex) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new ClinicalImportError(`La ficha ${recordIndex + 1} no es válida.`);
    const p = item as Record<string, unknown>;
    const name = text(p.name, 180, `el nombre de la ficha ${recordIndex + 1}`);
    const birthDate = text(p.birthDate, 10, `la fecha de nacimiento de ${name}`, { optional: true });
    const reason = text(p.reason, 240, `el motivo de consulta de ${name}`, { optional: true }) || "Evaluación";
    const history = text(p.history, 10000, `los antecedentes de ${name}`, { optional: true }) || "Sin registrar";
    const allergies = text(p.allergies, 2000, `las alergias de ${name}`, { optional: true }) || "Sin registrar";
    const driveFolderId = text(p.driveFolderId, 100, `la carpeta de Drive de ${name}`);
    const confirmedDifferentPatient = p.confirmedDifferentPatient === true;

    if (!hasFourNameParts(name) || (birthDate && !validDate(birthDate)) || !driveIdPattern.test(driveFolderId)) {
      throw new ClinicalImportError(`Revisa el nombre, fecha y carpeta de Drive de la ficha ${recordIndex + 1}.`);
    }
    if (folders.has(driveFolderId)) throw new ClinicalImportError(`La carpeta de Drive de ${name} aparece más de una vez en el lote.`);
    folders.add(driveFolderId);
    if (!Array.isArray(p.notes) || p.notes.length < 1 || p.notes.length > 30) {
      throw new ClinicalImportError(`${name} debe incluir entre 1 y 30 evoluciones.`);
    }
    const notes = p.notes.map((value, noteIndex) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new ClinicalImportError(`La evolución ${noteIndex + 1} de ${name} no es válida.`);
      const n = value as Record<string, unknown>;
      const clinicalDate = text(n.clinicalDate, 10, `la fecha de la evolución ${noteIndex + 1} de ${name}`, { optional: true });
      const title = text(n.title, 180, `el título de la evolución ${noteIndex + 1} de ${name}`);
      const body = text(n.body, 30000, `el texto de la evolución ${noteIndex + 1} de ${name}`);
      const sourceDocumentId = text(n.sourceDocumentId, 100, `el documento de origen de la evolución ${noteIndex + 1} de ${name}`);
      if ((clinicalDate && !validDate(clinicalDate)) || !title.trim() || !body.trim() || !driveIdPattern.test(sourceDocumentId)) {
        throw new ClinicalImportError(`Revisa fecha y documento de origen de la evolución ${noteIndex + 1} de ${name}.`);
      }
      const requestId = requestIdFor({ clinicalDate, sourceDocumentId, title, body });
      if (requestIds.has(requestId)) throw new ClinicalImportError("El mismo documento y fecha aparecen repetidos en el lote.");
      requestIds.add(requestId);
      return { clinicalDate, title, body, sourceDocumentId };
    });

    return { name, birthDate, reason, history, allergies, driveFolderId, confirmedDifferentPatient, notes };
  });
}
