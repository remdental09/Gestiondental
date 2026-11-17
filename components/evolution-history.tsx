import { Button } from "@/components/ui/button";
import { formatFdi, type OdontogramData } from "@/app/clinical-data";
import { installedImplantTeeth } from "@/app/implant-evidence";
import { groupEvolutionsByDay } from "@/lib/evolution-sessions";
import { Pencil, Trash2 } from "lucide-react";
import { useState } from "react";

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

type Props = {
  notes: EvolutionHistoryNote[];
  allNotes: EvolutionHistoryNote[];
  odontogram: OdontogramData;
  onSyncOdontogram: (note: EvolutionHistoryNote) => void | Promise<void>;
  onAnnul: (note: EvolutionHistoryNote) => void;
  /** Guarda el título y el texto corregidos a mano. Si falla, lanza un Error con el motivo. */
  onEdit?: (note: EvolutionHistoryNote, title: string, body: string) => Promise<void>;
};

export function EvolutionHistory({ notes, allNotes, odontogram, onSyncOdontogram, onAnnul, onEdit }: Props) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draftTitle, setDraftTitle] = useState(""), [draftBody, setDraftBody] = useState("");
  const [saving, setSaving] = useState(false), [editError, setEditError] = useState("");
  const startEdit = (note: EvolutionHistoryNote) => { setEditingId(note.id); setDraftTitle(note.title); setDraftBody(note.body); setEditError(""); };
  const saveEdit = async (note: EvolutionHistoryNote) => {
    if (!onEdit) return;
    if (!draftBody.trim()) { setEditError("La evolución no puede quedar vacía."); return; }
    setSaving(true); setEditError("");
    try { await onEdit(note, draftTitle.trim() || "Evolución clínica", draftBody); setEditingId(null); }
    catch (e) { setEditError(e instanceof Error ? e.message : "No se pudo guardar."); }
    finally { setSaving(false); }
  };
  const sessions = groupEvolutionsByDay(notes);
  if (!sessions.length) return <p className="rounded-xl border border-dashed border-[#dddbe6] p-6 text-center text-sm text-[#6b6a7c]">Todavía no hay evoluciones en esta ficha.</p>;

  return <div className="mt-6 space-y-6" data-testid="evolution-history">
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
              {editingId === note.id ? <div className="space-y-2" data-testid="evolution-editor"><label className="block text-xs font-medium text-[#615f73]">Título<input className="mt-1 block min-h-11 w-full rounded-lg border border-[#d2d4df] px-3 text-base font-semibold text-[#35343f] focus-visible:outline-2 focus-visible:outline-[#473a6d]" maxLength={180} value={draftTitle} onChange={e => setDraftTitle(e.target.value)} /></label><label className="block text-xs font-medium text-[#615f73]">Texto de la evolución<textarea className="mt-1 block min-h-48 w-full rounded-lg border border-[#d2d4df] px-3 py-2 text-sm leading-6 text-[#35343f] focus-visible:outline-2 focus-visible:outline-[#473a6d]" maxLength={30000} value={draftBody} onChange={e => setDraftBody(e.target.value)} data-testid="evolution-editor-body" /></label>{editError && <p role="alert" className="rounded-lg bg-rose-50 p-2 text-sm text-rose-800">{editError}</p>}<p className="text-xs text-[#615f73]">El odontograma no cambia solo al editar; si corresges piezas o procedimientos, revísalo.</p><div className="flex gap-2"><Button type="button" size="sm" className="min-h-10 bg-[#473a6d] hover:bg-[#3a2f5a]" disabled={saving} onClick={() => void saveEdit(note)} data-testid="evolution-editor-save">{saving ? "Guardando…" : "Guardar cambios"}</Button><Button type="button" variant="outline" size="sm" className="min-h-10" disabled={saving} onClick={() => setEditingId(null)}>Cancelar</Button></div></div> : <>
              <h4 className={`font-semibold ${annulled ? "text-[#6b6a7c] line-through" : ""}`}>{note.title}{annulled && <span className="ml-2 text-xs font-medium text-rose-800">Anulada</span>}</h4>
              {note.mine === false && <p className="mt-1 text-xs text-[#615f73]" data-testid="note-author">Escrita por {note.authorName || note.authorEmail || "otro profesional"}</p>}
              {replacedNote && <p className="mt-1 text-xs text-[#615f73]">Reemplaza a la evolución anulada del {replacedNote.date || "registro anterior"}</p>}
              <p className={`mt-2 whitespace-pre-wrap text-sm leading-6 ${annulled ? "text-[#8b8ca3] line-through" : "text-[#57566a]"}`}>{note.body}</p></>}
              {annulled ? <p className="mt-2 rounded-lg bg-rose-50 p-2 text-xs leading-5 text-rose-950">Anulada{note.annulledAt ? ` el ${new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short", timeZone: "America/Santiago" }).format(new Date(note.annulledAt))}` : ""}{note.annulledBy ? ` por ${note.annulledBy}` : ""}{note.annulReason ? ` · Motivo: ${note.annulReason}` : ""}</p> : <>
                {!!note.diagnoses?.length && <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Diagnósticos de la evolución" data-testid="note-diagnoses">{note.diagnoses.map((diagnosis, diagnosisIndex) => <li key={diagnosis.id ?? diagnosisIndex} title={diagnosis.findings || undefined} className="rounded-full border border-[#cfe3e3] bg-[#efeef4] px-2.5 py-0.5 text-xs text-[#3b3355]">{diagnosis.tooth ? <span className="font-medium">FDI {formatFdi(diagnosis.tooth)} · </span> : null}{diagnosis.title} <span className="font-mono text-[11px] text-[#615f73]">{diagnosis.code || "sin código"}</span></li>)}</ul>}
                {needsOdontogramSync && <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => onSyncOdontogram(note)}>Actualizar odontograma desde esta evolución</Button>}
                {note.backupStatus === "not_configured" && <p className="mt-1 text-xs text-amber-800">Guardado en la ficha · respaldo en Drive pendiente</p>}
                {note.sourceDocumentId && <a className="mt-2 inline-block text-xs font-medium text-[#473a6d] underline" href={`https://docs.google.com/document/d/${note.sourceDocumentId}/edit`} target="_blank" rel="noopener noreferrer">Ver documento original en Drive</a>}
                {note.mine !== false && <div className="mt-2 flex flex-wrap gap-1">{onEdit && editingId !== note.id && <Button type="button" variant="ghost" size="sm" className="min-h-10 px-2 text-[#473a6d] hover:bg-[#ece8f6]" onClick={() => startEdit(note)} data-testid="note-edit"><Pencil className="mr-1.5 size-4" aria-hidden="true"/>Editar</Button>}<Button type="button" variant="ghost" size="sm" className="min-h-10 px-2 text-[#a43542] hover:bg-rose-50 hover:text-[#8a2c37]" onClick={() => onAnnul(note)} data-testid="note-annul"><Trash2 className="mr-1.5 size-4" aria-hidden="true"/>Eliminar evolución</Button></div>}
              </>}
            </article>;
          })}
        </div>
      </section>;
    })}
  </div>;
}
