"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowRight, Clock, ListPlus, MessageCircle, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { averageWait, chileClock, offerMessage, suggestForSlot, waitLabel, waitingRoom, waLink, WAIT_PREFERENCES, WAIT_PREFERENCE_LABEL, type CycleTimes, type WaitEntry, type WaitPreference } from "@/lib/appointment-cycle";
import { whatsappNumber } from "@/lib/agenda-box";
import type { AttendanceStatus } from "@/lib/dashboard";

type Appt = CycleTimes & { key: string; patientName: string; start: string; status: AttendanceStatus; boxId: number | null; patientId: number | null };
type PatientLite = { id: number; name: string; rut: string | null; phone: string };
const fieldCls = "h-11 w-full rounded-md border border-[#d9d5e4] bg-white px-2 text-base sm:h-9 sm:text-sm";
const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
const longDay = (day: string) => new Intl.DateTimeFormat("es-CL", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(new Date(day + "T12:00:00Z"));

/** «Sala de espera» del día: quién llegó, hace cuánto espera y botón «Pasar a box». */
export function WaitingRoom<T extends Appt>({ appts, nowIso, boxName, onToBox, canMove }: { appts: T[]; nowIso: string; boxName: (id: number | null) => string; onToBox: (appt: T) => void; canMove: boolean }) {
  const waiting = waitingRoom(appts, nowIso);
  const inBox = appts.filter(a => a.status === "ingresada");
  const avg = averageWait(appts);
  return <section className="mt-3 rounded-xl border border-[#f4c98f] bg-[#fff8ef] p-3" aria-label="Sala de espera" data-testid="waiting-room">
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <h4 className="flex items-center gap-1.5 font-semibold text-[#7a4a12]"><Clock className="size-4" aria-hidden="true" />Sala de espera <span className="rounded-full bg-[#f49f33] px-2 text-xs text-white">{waiting.length}</span></h4>
      <p className="text-xs text-[#7a5a32]">En box ahora: {inBox.length ? inBox.map(a => `${a.patientName} (${boxName(a.boxId)})`).join(", ") : "nadie"}{avg !== null ? ` · Espera promedio hoy: ${waitLabel(avg)}` : ""}</p>
    </div>
    {waiting.length === 0 ? <p className="mt-1 text-sm text-[#7a5a32]">Nadie esperando. Cuando un paciente llegue, toca su cita y marca «🪑 Llegó».</p> :
      <ul className="mt-2 space-y-2">{waiting.map(a => <li key={a.key} className="flex flex-wrap items-center gap-2 rounded-lg bg-white p-2 shadow-sm ring-1 ring-[#f4c98f]" data-testid="waiting-item">
        <div className="min-w-0 basis-full sm:basis-0 sm:flex-1">
          <p className="truncate font-medium">{a.patientName}</p>
          <p className="text-xs text-[#615f73]">Cita {a.start} · {boxName(a.boxId)}{a.arrivedAt ? ` · llegó ${chileClock(a.arrivedAt)}` : ""}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
        <span className={"rounded-full px-2 py-0.5 text-sm font-semibold " + ((a.waiting ?? 0) >= 20 ? "bg-rose-100 text-rose-900" : "bg-amber-100 text-amber-900")} data-testid="waiting-minutes">⏱ {waitLabel(a.waiting)}</span>
        {canMove && <Button type="button" className="min-h-11 bg-[#64b873] text-[#10331a] hover:bg-[#55a764] sm:min-h-9" onClick={() => onToBox(a)} data-testid="to-box"><ArrowRight className="mr-1 size-4" />Pasar a box</Button>}
        </div>
      </li>)}</ul>}
  </section>;
}

async function waitlistCall(body?: Record<string, unknown>): Promise<Record<string, unknown>> {
  const response = await fetch("/api/lista-espera", body ? { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const data = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : "No se pudo cargar la lista de espera.");
  return data;
}
export function useWaitlist(enabled: boolean) {
  const [entries, setEntries] = useState<WaitEntry[] | null>(null);
  const [error, setError] = useState("");
  const [key, setKey] = useState(0);
  const reload = useCallback(() => setKey(k => k + 1), []);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    waitlistCall().then(data => { if (live) { setEntries((data.entries as WaitEntry[]) ?? []); setError(""); } }).catch(cause => { if (live) setError(cause instanceof Error ? cause.message : "Error"); });
    return () => { live = false; };
  }, [enabled, key]);
  return { entries, error, reload };
}

function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
    <div className="max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl sm:max-w-lg sm:rounded-2xl" onClick={event => event.stopPropagation()}>
      <div className="mb-3 flex items-center justify-between gap-2"><h4 className="text-lg font-semibold">{title}</h4><button type="button" aria-label="Cerrar" className="grid size-11 place-items-center rounded-full hover:bg-[#efeef4]" onClick={onClose}><X className="size-5" /></button></div>
      {children}
    </div>
  </div>;
}

/** Lista de espera: pacientes que quieren una hora antes; se agregan con preferencia y nota. */
export function WaitlistSheet({ patients, canEdit, onClose }: { patients: PatientLite[]; canEdit: boolean; onClose: () => void }) {
  const { entries, error, reload } = useWaitlist(true);
  const [query, setQuery] = useState("");
  const [patient, setPatient] = useState<PatientLite | null>(null);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [preference, setPreference] = useState<WaitPreference>("cualquiera");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const matches = query.trim().length >= 2 ? patients.filter(p => fold(p.name).includes(fold(query)) || (p.rut ?? "").replace(/\W/g, "").includes(query.replace(/\W/g, ""))).slice(0, 6) : [];
  const add = async () => {
    setBusy(true); setMessage("");
    try {
      await waitlistCall({ action: "agregar", ...(patient ? { patientId: patient.id } : { name: name || query, phone }), preference, note });
      setPatient(null); setQuery(""); setName(""); setPhone(""); setNote(""); setPreference("cualquiera"); reload();
    } catch (cause) { setMessage(cause instanceof Error ? cause.message : "No se pudo agregar."); } finally { setBusy(false); }
  };
  const remove = async (id: number) => { try { await waitlistCall({ action: "quitar", id }); reload(); } catch (cause) { setMessage(cause instanceof Error ? cause.message : "No se pudo quitar."); } };
  return <Sheet title="Lista de espera" onClose={onClose}>
    <p className="text-sm text-[#615f73]">Pacientes que quieren una hora antes. Cuando se cancele o reagende una cita, la agenda te sugerirá a quién ofrecerle el cupo por WhatsApp.</p>
    {canEdit && <div className="mt-3 space-y-2 rounded-xl border border-[#e6e4ee] p-3" data-testid="waitlist-form">
      {patient ? <p className="flex items-center justify-between rounded-lg bg-[#efeef4] p-2 text-sm"><span className="font-medium">{patient.name}</span><button type="button" className="text-[#473a6d] underline" onClick={() => setPatient(null)}>Cambiar</button></p> : <>
        <label className="block space-y-1 text-sm font-medium">Paciente<input className={fieldCls} value={query} placeholder="Busca por nombre o RUT, o escribe un nombre nuevo" onChange={event => setQuery(event.target.value)} /></label>
        {matches.length > 0 && <ul className="space-y-1">{matches.map(p => <li key={p.id}><button type="button" className="min-h-11 w-full rounded-lg border border-[#e6e4ee] px-2 text-left text-sm hover:bg-[#f7f6fa]" onClick={() => { setPatient(p); setQuery(""); }}>{p.name}{p.rut ? ` · ${p.rut}` : ""}</button></li>)}</ul>}
        {query.trim().length >= 3 && matches.length === 0 && <label className="block space-y-1 text-sm font-medium">Teléfono (opcional)<input className={fieldCls} inputMode="tel" value={phone} onChange={event => { setName(query); setPhone(event.target.value); }} /></label>}
      </>}
      <label className="block space-y-1 text-sm font-medium">Preferencia
        <select className={fieldCls} value={preference} onChange={event => setPreference(event.target.value as WaitPreference)}>{WAIT_PREFERENCES.map(p => <option key={p} value={p}>{WAIT_PREFERENCE_LABEL[p]}</option>)}</select>
      </label>
      <label className="block space-y-1 text-sm font-medium">Nota<input className={fieldCls} value={note} maxLength={300} placeholder="Ej: solo martes, urgencia leve, con la Dra. Pérez" onChange={event => setNote(event.target.value)} /></label>
      <Button type="button" className="min-h-11 w-full bg-[#473a6d] hover:bg-[#3a2f5a]" disabled={busy || !(patient || query.trim().length >= 3)} onClick={() => void add()} data-testid="waitlist-add"><ListPlus className="mr-1 size-4" />{busy ? "Guardando…" : "Agregar a la lista"}</Button>
    </div>}
    {(message || error) && <p role="alert" className="mt-3 rounded-lg bg-rose-50 p-3 text-sm text-rose-950">{message || error}</p>}
    {!entries && !error && <p className="mt-3 text-sm text-[#6b6a7c]">Cargando…</p>}
    {entries && (entries.length === 0 ? <p className="mt-3 text-sm text-[#6b6a7c]">La lista está vacía.</p> :
      <ul className="mt-3 space-y-2" data-testid="waitlist">{entries.map(e => <li key={e.id} className="flex items-start gap-2 rounded-lg border border-[#e6e4ee] p-2 text-sm">
        <div className="min-w-0 flex-1"><p className="font-medium">{e.name}</p><p className="text-xs text-[#615f73]">{WAIT_PREFERENCE_LABEL[e.preference]}{e.phone ? ` · ${e.phone}` : ""}{e.note ? ` · ${e.note}` : ""}</p></div>
        {canEdit && <button type="button" aria-label={`Quitar a ${e.name} de la lista`} className="grid size-11 place-items-center rounded-full text-[#a43542] hover:bg-rose-50" onClick={() => void remove(e.id)}><Trash2 className="size-4" /></button>}
      </li>)}</ul>)}
  </Sheet>;
}

/** Cupo liberado (cancelada / reagendada): sugiere personas de la lista de espera con un enlace wa.me (se envía a mano). */
export function FreedSlotSuggestions({ slot, onClose, canEdit }: { slot: { day: string; start: string; patientId: number | null; boxLabel: string }; onClose: () => void; canEdit: boolean }) {
  const { entries, error, reload } = useWaitlist(true);
  const suggestions = entries ? suggestForSlot(entries, slot) : [];
  const dayLabel = longDay(slot.day);
  return <section className="mt-3 rounded-xl border border-[#c9c0e3] bg-[#f6f3fd] p-3" aria-label="Cupo liberado" data-testid="freed-slot">
    <div className="flex items-start justify-between gap-2">
      <p className="text-sm"><b>Se liberó el cupo</b> del {dayLabel} a las {slot.start} ({slot.boxLabel}). {suggestions.length ? "Puedes ofrecérselo a:" : entries ? "No hay nadie en la lista de espera." : ""}</p>
      <button type="button" aria-label="Cerrar sugerencias" className="grid size-11 shrink-0 place-items-center rounded-full hover:bg-white" onClick={onClose}><X className="size-4" /></button>
    </div>
    {error && <p className="text-sm text-rose-900">{error}</p>}
    {suggestions.length > 0 && <ul className="mt-2 space-y-2">{suggestions.map(e => { const wa = whatsappNumber(e.phone); return <li key={e.id} className="flex flex-wrap items-center gap-2 rounded-lg bg-white p-2 text-sm shadow-sm" data-testid="waitlist-suggestion">
      <div className="min-w-0 flex-1"><p className="font-medium">{e.name}</p><p className="text-xs text-[#615f73]">{WAIT_PREFERENCE_LABEL[e.preference]}{e.note ? ` · ${e.note}` : ""}</p></div>
      {wa ? <a href={waLink(wa, offerMessage(e.name, { dayLabel, start: slot.start }))} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1 rounded-full bg-[#25d366] px-3 text-sm font-semibold text-white sm:min-h-9" data-testid="offer-whatsapp"><MessageCircle className="size-4" />Ofrecer por WhatsApp</a> : <span className="text-xs text-[#6b6a7c]">Sin celular registrado</span>}
      {canEdit && <button type="button" className="min-h-11 rounded-full border border-[#dddbe6] px-3 text-xs sm:min-h-9" onClick={async () => { await waitlistCall({ action: "quitar", id: e.id }).catch(() => undefined); reload(); }}>Ya agendado · quitar</button>}
    </li>; })}</ul>}
    <p className="mt-2 text-xs text-[#6b6a7c]">El mensaje se abre en WhatsApp para que lo envíes tú; la app no envía nada sola.</p>
  </section>;
}
