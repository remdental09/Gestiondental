import { Button } from "@/components/ui/button";
import { formatFdi, type OdontogramData } from "@/app/clinical-data";
import { installedImplantTeeth } from "@/app/implant-evidence";
import { groupEvolutionsByDay } from "@/lib/evolution-sessions";
import { Trash2 } from "lucide-react";

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
};

type Props = {
  notes: EvolutionHistoryNote[];
  allNotes: EvolutionHistoryNote[];
  odontogram: OdontogramData;
  onSyncOdontogram: (note: EvolutionHistoryNote) => void | Promise<void>;
  onAnnul: (note: EvolutionHistoryNote) => void;
};

export function EvolutionHistory({ notes, allNotes, odontogram, onSyncOdontogram, onAnnul }: Props) {
  const sessions = groupEvolutionsByDay(notes);
  if (!sessions.length) return <p className="rounded-xl border border-dashed border-[#dce5e7] p-6 text-center text-sm text-[#71858b]">Todavía no hay evoluciones en esta ficha.</p>;

  return <div className="mt-6 space-y-6" data-testid="evolution-history">
    {sessions.map(session => {
      const onlyAnnulled = session.notes.every(note => note.status === "anulada");
      return <section key={session.key} className={`relative border-l-2 pl-5 ${onlyAnnulled ? "border-rose-200 opacity-80" : "border-[#9bd6d0]"}`} aria-label={`Sesión clínica del ${session.date}`} data-testid="evolution-session" data-session-day={session.key}>
        <span className={`absolute -left-[6px] top-1.5 size-2.5 rounded-full ${onlyAnnulled ? "bg-rose-300" : "bg-[#087f83]"} `} />
        <p className="text-xs font-medium uppercase tracking-wide text-[#71858b]">{session.date}</p>
        {session.notes.length > 1 && <p className="mt-1 text-xs font-medium text-[#60757a]">{session.notes.length} registros de la misma atención</p>}
        <div className="mt-2">
          {session.notes.map((note, index) => {
            const annulled = note.status === "anulada";
            const replacedNote = note.replacesId ? allNotes.find(item => item.id === note.replacesId) : undefined;
            const needsOdontogramSync = installedImplantTeeth(note.body).some(tooth => odontogram.teeth[tooth] !== "Implante");
            return <article key={note.id} className={`${index ? "border-t border-[#e8eeee] pt-4" : ""} ${annulled ? "opacity-80" : ""}`} data-testid={annulled ? "note-annulled" : "evolution-record"}>
              <h4 className={`font-semibold ${annulled ? "text-[#71858b] line-through" : ""}`}>{note.title}{annulled && <span className="ml-2 text-xs font-medium text-rose-800">Anulada</span>}</h4>
              {replacedNote && <p className="mt-1 text-xs text-[#60757a]">Reemplaza a la evolución anulada del {replacedNote.date || "registro anterior"}</p>}
              <p className={`mt-2 whitespace-pre-wrap text-sm leading-6 ${annulled ? "text-[#8aa0a5] line-through" : "text-[#53686e]"}`}>{note.body}</p>
              {annulled ? <p className="mt-2 rounded-lg bg-rose-50 p-2 text-xs leading-5 text-rose-950">Anulada{note.annulledAt ? ` el ${new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short", timeZone: "America/Santiago" }).format(new Date(note.annulledAt))}` : ""}{note.annulledBy ? ` por ${note.annulledBy}` : ""}{note.annulReason ? ` · Motivo: ${note.annulReason}` : ""}</p> : <>
                {!!note.diagnoses?.length && <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Diagnósticos de la evolución" data-testid="note-diagnoses">{note.diagnoses.map((diagnosis, diagnosisIndex) => <li key={diagnosis.id ?? diagnosisIndex} title={diagnosis.findings || undefined} className="rounded-full border border-[#cfe3e3] bg-[#f1f7f7] px-2.5 py-0.5 text-xs text-[#31575b]">{diagnosis.tooth ? <span className="font-medium">FDI {formatFdi(diagnosis.tooth)} · </span> : null}{diagnosis.title} <span className="font-mono text-[11px] text-[#60757a]">{diagnosis.code || "sin código"}</span></li>)}</ul>}
                {needsOdontogramSync && <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => onSyncOdontogram(note)}>Actualizar odontograma desde esta evolución</Button>}
                {note.backupStatus === "not_configured" && <p className="mt-1 text-xs text-amber-800">Guardado en la ficha · respaldo en Drive pendiente</p>}
                {note.sourceDocumentId && <a className="mt-2 inline-block text-xs font-medium text-[#087f83] underline" href={`https://docs.google.com/document/d/${note.sourceDocumentId}/edit`} target="_blank" rel="noopener noreferrer">Ver documento original en Drive</a>}
                <div className="mt-2"><Button type="button" variant="ghost" size="sm" className="min-h-10 px-2 text-[#a43542] hover:bg-rose-50 hover:text-[#8a2c37]" onClick={() => onAnnul(note)} data-testid="note-annul"><Trash2 className="mr-1.5 size-4" aria-hidden="true"/>Eliminar evolución</Button></div>
              </>}
            </article>;
          })}
        </div>
      </section>;
    })}
  </div>;
}
