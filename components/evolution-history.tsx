import { Button } from "@/components/ui/button";
import { formatFdi, type OdontogramData } from "@/app/clinical-data";
import { installedImplantTeeth } from "@/app/implant-evidence";
import { groupEvolutionsByDay } from "@/lib/evolution-sessions";
import { evolutionHeadline, zoneOfPiece } from "@/lib/evolution-headline";
import { ChevronDown, ChevronRight, Pencil, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";

export type EvolutionHistoryDiagnosis = {
  id?: number;
  code: string;
  title: string;
  tooth: number | null;
  findings: string;
  suggestedFrom?: string | null;
};

export type EvolutionHistoryNote = {
  id: number;
  patientId: number;
  date: string;
  title: string;
  body: string;
  backupStatus?: string;
  sourceDocumentId?: string | null;
  recordedAt?: string;
  clinicalDate?: string;
  diagnoses?: EvolutionHistoryDiagnosis[];
  /** Resumen mínimo por pieza de la evolución («2.5 Resina ✓»). */
  pieces?: { t: string; s: "ok" | "avance" | "plan" | "dx" }[];
  status?: string;
  annulledAt?: string | null;
  annulledBy?: string | null;
  annulReason?: string | null;
  replacesId?: number | null;
  /** Autoría dentro de una clínica compartida. `mine: false` = la escribió otro profesional y solo él puede cambiarla. */
  authorName?: string;
  authorEmail?: string;
  mine?: boolean;
};

const PIECE_MARK = { ok: "✓", avance: "↻", plan: "◇", dx: "•" } as const;

type Props = {
  notes: EvolutionHistoryNote[];
  allNotes: EvolutionHistoryNote[];
  odontogram: OdontogramData;
  onSyncOdontogram: (note: EvolutionHistoryNote) => void | Promise<void>;
  onAnnul: (note: EvolutionHistoryNote) => void;
  /** Guarda el título y el texto corregidos a mano. Si falla, lanza un Error con el motivo. */
  onEdit?: (note: EvolutionHistoryNote, title: string, body: string) => Promise<void>;
  /** Riel vertical de herramientas al lado de cada evolución (la más reciente lo muestra completo). */
  rail?: (note: EvolutionHistoryNote, latest: boolean) => ReactNode;
  /** Contenido bajo una evolución (p. ej. el formulario de control abierto desde el riel). */
  below?: (note: EvolutionHistoryNote) => ReactNode;
};

export function EvolutionHistory({ notes, allNotes, odontogram, onSyncOdontogram, onAnnul, onEdit, rail, below }: Props) {
  const latestId = notes.find(note => note.status !== "anulada")?.id;
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftTitle, setDraftTitle] = useState(""), [draftBody, setDraftBody] = useState("");
  const [saving, setSaving] = useState(false), [editError, setEditError] = useState("");
  // Cada evolución sale comprimida (una línea: qué se hizo ese día); se abre una a una o todas juntas.
  const [expanded, setExpanded] = useState<Set<number>>(() => new Set());
  const [zone, setZone] = useState("");
  const toggle = (id: number) => setExpanded(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  const startEdit = (note: EvolutionHistoryNote) => { setEditingId(note.id); setDraftTitle(note.title); setDraftBody(note.body); setEditError(""); };
  const saveEdit = async (note: EvolutionHistoryNote) => {
    if (!onEdit) return;
    if (!draftBody.trim()) { setEditError("La evolución no puede quedar vacía."); return; }
    setSaving(true); setEditError("");
    try { await onEdit(note, draftTitle.trim() || "Evolución clínica", draftBody); setEditingId(null); }
    catch (e) { setEditError(e instanceof Error ? e.message : "No se pudo guardar."); }
    finally { setSaving(false); }
  };
  // Hora de registro en Chile; las evoluciones importadas traen un mediodía de relleno y no se muestran con hora.
  const timeOf = (recordedAt?: string) => {
    if (!recordedAt || recordedAt.endsWith("T12:00:00.000Z")) return "";
    const date = new Date(recordedAt);
    return Number.isNaN(date.getTime()) ? "" : new Intl.DateTimeFormat("es-CL", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Santiago" }).format(date);
  };
  const zonesOf = (note: EvolutionHistoryNote) => [...new Set([...(note.pieces ?? []).map(piece => zoneOfPiece(piece.t)), ...(note.diagnoses ?? []).map(diagnosis => diagnosis.tooth ? formatFdi(diagnosis.tooth) : "")].filter(Boolean))];
  const allZones = [...new Set(notes.flatMap(zonesOf))].sort((a, b) => a.localeCompare(b, "es-CL", { numeric: true }));
  const visibleNotes = zone ? notes.filter(note => zonesOf(note).includes(zone)) : notes;
  const allOpen = visibleNotes.length > 0 && visibleNotes.every(note => expanded.has(note.id));
  const sessions = groupEvolutionsByDay(visibleNotes);
  if (!notes.length) return <p className="rounded-xl border border-dashed border-[#dddbe6] p-6 text-center text-sm text-[#6b6a7c]">Todavía no hay evoluciones en esta ficha.</p>;

  return <div className="mt-6 space-y-6" data-testid="evolution-history">
    <div className="flex flex-wrap items-center justify-between gap-2" data-testid="evolution-controls">
      <Button type="button" variant="outline" size="sm" className="min-h-10" aria-pressed={allOpen} onClick={() => setExpanded(allOpen ? new Set() : new Set(visibleNotes.map(note => note.id)))} data-testid="evolution-toggle-all">{allOpen ? "Comprimir todo" : "Expandir todo"}</Button>
      {allZones.length > 1 && <label className="flex items-center gap-2 text-xs font-medium text-[#615f73]">Pieza o zona<select className="min-h-10 rounded-lg border border-[#d2d4df] bg-white px-2 text-sm text-[#35343f]" value={zone} onChange={event => setZone(event.target.value)} data-testid="evolution-zone-filter"><option value="">Todas</option>{allZones.map(item => <option key={item} value={item}>{item}</option>)}</select></label>}
    </div>
    <div className="max-h-[70dvh] space-y-6 overflow-y-auto overscroll-contain pl-2 pr-3" tabIndex={0} role="region" aria-label="Evoluciones: desplázate para recorrerlas" data-testid="evolution-scroll">
    {!sessions.length && <p className="rounded-xl border border-dashed border-[#dddbe6] p-6 text-center text-sm text-[#6b6a7c]">Ninguna evolución menciona «{zone}».</p>}
    {sessions.map(session => {
      const onlyAnnulled = session.notes.every(note => note.status === "anulada");
      return <section key={session.key} className={`relative border-l-2 pl-5 ${onlyAnnulled ? "border-rose-200 opacity-80" : "border-[#9bd6d0]"}`} aria-label={`Sesión clínica del ${session.date}`} data-testid="evolution-session" data-session-day={session.key}>
        <span className={`absolute -left-[6px] top-1.5 size-2.5 rounded-full ${onlyAnnulled ? "bg-rose-300" : "bg-[#473a6d]"} `} />
        <p className="text-xs font-medium uppercase tracking-wide text-[#6b6a7c]">{session.date}</p>
        {session.notes.length > 1 && <p className="mt-1 text-xs font-medium text-[#615f73]">{session.notes.length} registros de la misma atención</p>}
        <div className="mt-2">
          {session.notes.map((note, index) => {
            const annulled = note.status === "anulada";
            const replacedNote = note.replacesId ? allNotes.find(item => item.id === note.replacesId) : undefined;
            const needsOdontogramSync = installedImplantTeeth(note.body).some(tooth => odontogram.teeth[tooth] !== "Implante");
            return <article key={note.id} className={`${index ? "border-t border-[#ebeaf1] pt-4" : ""} ${annulled ? "opacity-80" : ""}`} data-testid={annulled ? "note-annulled" : "evolution-record"}>
              {(() => { const open = expanded.has(note.id) || editingId === note.id; const zones = zonesOf(note); const tags = (note.diagnoses ?? []).slice(0, 2); return <button type="button" aria-expanded={open} onClick={() => toggle(note.id)} className="flex min-h-11 w-full items-center gap-2 rounded-lg px-1 text-left hover:bg-[#f6f5fa] focus-visible:outline-2 focus-visible:outline-[#473a6d]" data-testid="evolution-row">
                {open ? <ChevronDown className="size-4 shrink-0 text-[#473a6d]" aria-hidden="true" /> : <ChevronRight className="size-4 shrink-0 text-[#473a6d]" aria-hidden="true" />}
                {timeOf(note.recordedAt) && <span className="shrink-0 rounded bg-[#efeef4] px-1.5 py-0.5 text-xs font-medium text-[#473a6d]">{timeOf(note.recordedAt)} h</span>}
                <span className={`min-w-0 flex-1 text-sm font-medium ${annulled ? "text-[#6b6a7c] line-through" : "text-[#35343f]"}`} data-testid="evolution-headline">{evolutionHeadline(note)}</span>
                {annulled && <span className="shrink-0 text-xs font-medium text-rose-800">Anulada</span>}
                {!annulled && zones.slice(0, 4).map(item => <span key={item} className="hidden shrink-0 rounded-full bg-[#efeef4] px-2 py-0.5 text-[11px] font-medium text-[#3b3355] sm:inline">{item}</span>)}
                {!annulled && tags.map((diagnosis, index) => <span key={diagnosis.id ?? index} className="hidden shrink-0 rounded-full border border-[#cfe3e3] px-2 py-0.5 text-[11px] text-[#3b3355] md:inline">{diagnosis.title}</span>)}
              </button>; })()}
              {(expanded.has(note.id) || editingId === note.id) && <div className="mt-2 border-l border-[#ebeaf1] pl-3"><div className={rail && !annulled && editingId !== note.id ? "grid grid-cols-[minmax(0,1fr)_auto] gap-2" : ""}><div className="min-w-0">
              {editingId === note.id ? <div className="space-y-2" data-testid="evolution-editor"><label className="block text-xs font-medium text-[#615f73]">Título<input className="mt-1 block min-h-11 w-full rounded-lg border border-[#d2d4df] px-3 text-base font-semibold text-[#35343f] focus-visible:outline-2 focus-visible:outline-[#473a6d]" maxLength={180} value={draftTitle} onChange={e => setDraftTitle(e.target.value)} /></label><label className="block text-xs font-medium text-[#615f73]">Texto de la evolución<textarea className="mt-1 block min-h-48 w-full rounded-lg border border-[#d2d4df] px-3 py-2 text-sm leading-6 text-[#35343f] focus-visible:outline-2 focus-visible:outline-[#473a6d]" maxLength={30000} value={draftBody} onChange={e => setDraftBody(e.target.value)} data-testid="evolution-editor-body" /></label>{editError && <p role="alert" className="rounded-lg bg-rose-50 p-2 text-sm text-rose-800">{editError}</p>}<p className="text-xs text-[#615f73]">El odontograma no cambia solo al editar; si corresges piezas o procedimientos, revísalo.</p><div className="flex gap-2"><Button type="button" size="sm" className="min-h-10 bg-[#473a6d] hover:bg-[#3a2f5a]" disabled={saving} onClick={() => void saveEdit(note)} data-testid="evolution-editor-save">{saving ? "Guardando…" : "Guardar cambios"}</Button><Button type="button" variant="outline" size="sm" className="min-h-10" disabled={saving} onClick={() => setEditingId(null)}>Cancelar</Button></div></div> : <>
              <h4 className={`font-semibold ${annulled ? "text-[#6b6a7c] line-through" : ""}`}>{timeOf(note.recordedAt) && <time dateTime={note.recordedAt} className="mr-2 rounded bg-[#efeef4] px-1.5 py-0.5 text-xs font-medium text-[#473a6d] no-underline" data-testid="note-time">{timeOf(note.recordedAt)} h</time>}{note.title}{annulled && <span className="ml-2 text-xs font-medium text-rose-800">Anulada</span>}</h4>
              {note.mine === false && <p className="mt-1 text-xs text-[#615f73]" data-testid="note-author">Escrita por {note.authorName || note.authorEmail || "otro profesional"}</p>}
              {replacedNote && <p className="mt-1 text-xs text-[#615f73]">Reemplaza a la evolución anulada del {replacedNote.date || "registro anterior"}</p>}
              <p className={`mt-2 whitespace-pre-wrap text-sm leading-6 ${annulled ? "text-[#8b8ca3] line-through" : "text-[#57566a]"}`}>{note.body}</p></>}
              {annulled ? <p className="mt-2 rounded-lg bg-rose-50 p-2 text-xs leading-5 text-rose-950">Anulada{note.annulledAt ? ` el ${new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short", timeZone: "America/Santiago" }).format(new Date(note.annulledAt))}` : ""}{note.annulledBy ? ` por ${note.annulledBy}` : ""}{note.annulReason ? ` · Motivo: ${note.annulReason}` : ""}</p> : <>
                {!!note.pieces?.length && <p className="mt-1.5 flex flex-wrap gap-x-2 gap-y-0.5 text-[11px] leading-4 text-[#615f73]" aria-label="Piezas de la evolución" data-testid="note-pieces">{note.pieces.map((piece, pieceIndex) => <span key={pieceIndex} className={piece.s === "ok" ? "text-emerald-800" : piece.s === "avance" ? "text-sky-800" : piece.s === "plan" ? "text-amber-800" : "text-rose-800"}>{piece.t} {PIECE_MARK[piece.s]}</span>)}</p>}
                {!!note.diagnoses?.length && <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Diagnósticos de la evolución" data-testid="note-diagnoses">{note.diagnoses.map((diagnosis, diagnosisIndex) => <li key={diagnosis.id ?? diagnosisIndex} title={diagnosis.findings || undefined} className="rounded-full border border-[#cfe3e3] bg-[#efeef4] px-2.5 py-0.5 text-xs text-[#3b3355]">{diagnosis.tooth ? <span className="font-medium">FDI {formatFdi(diagnosis.tooth)} · </span> : null}{diagnosis.title} <span className="font-mono text-[11px] text-[#615f73]">{diagnosis.code || "sin código"}</span></li>)}</ul>}
                {needsOdontogramSync && <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => onSyncOdontogram(note)}>Actualizar odontograma desde esta evolución</Button>}
                {note.backupStatus === "not_configured" && <p className="mt-1 text-xs text-amber-800">Guardado en la ficha · respaldo en Drive pendiente</p>}
                {note.sourceDocumentId && <a className="mt-2 inline-block text-xs font-medium text-[#473a6d] underline" href={`https://docs.google.com/document/d/${note.sourceDocumentId}/edit`} target="_blank" rel="noopener noreferrer">Ver documento original en Drive</a>}
                {note.mine !== false && <div className="mt-2 flex flex-wrap gap-1">{onEdit && editingId !== note.id && <Button type="button" variant="ghost" size="sm" className="min-h-10 px-2 text-[#473a6d] hover:bg-[#ece8f6]" onClick={() => startEdit(note)} data-testid="note-edit"><Pencil className="mr-1.5 size-4" aria-hidden="true"/>Editar</Button>}<Button type="button" variant="ghost" size="sm" className="min-h-10 px-2 text-[#a43542] hover:bg-rose-50 hover:text-[#8a2c37]" onClick={() => onAnnul(note)} data-testid="note-annul"><Trash2 className="mr-1.5 size-4" aria-hidden="true"/>Eliminar evolución</Button></div>}
              </>}
              </div>{rail && !annulled && editingId !== note.id && rail(note, note.id === latestId)}</div></div>}
              {below?.(note)}
            </article>;
          })}
        </div>
      </section>;
    })}
    </div>
  </div>;
}
