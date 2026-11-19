"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { normalizeAnamnesis, type Anamnesis } from "@/lib/anamnesis";
import type { BudgetItem } from "@/lib/budget-plans";
import { ALERT_TEXT_MAX, deriveAdminAlerts, deriveMedicalAlerts, type AlertKind, type ManualAlert } from "@/lib/patient-alerts";

type Loaded = { patientId: number; anamnesis: Anamnesis | null; alerts: ManualAlert[]; error: string };
const KIND = {
  medica: { title: "Alertas médicas", head: "bg-[#c81e32] text-white", box: "border-rose-300", chip: "border-rose-300 bg-rose-50 text-rose-900", placeholder: "Nueva alerta médica (p. ej. «Pedir interconsulta a cardiología antes de extraer»)" },
  administrativa: { title: "Alertas administrativas", head: "bg-amber-500 text-white", box: "border-amber-300", chip: "border-amber-300 bg-amber-50 text-amber-950", placeholder: "Nueva alerta administrativa (p. ej. «Paga con transferencia; pedir comprobante»)" },
} as const;

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { cache: "no-store", ...init, headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) } });
  const data = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || "No se pudo guardar.");
  return data;
}

/**
 * Alertas siempre visibles en la barra fija de la ficha (como en Dentalsoft, adaptado al celular):
 * chips rojos (médicas) y ámbar (administrativas); un toque abre los dos cuadros para agregar, editar o quitar.
 * Las automáticas salen de la anamnesis, de alergias/antecedentes de la ficha y del saldo por prestaciones realizadas.
 */
export function PatientAlertsBar({ patientId, allergies, history, budgets, payments }: {
  patientId: number;
  allergies?: string;
  history?: string;
  budgets: Array<{ id: number; isAlternative: boolean; items: BudgetItem[]; title?: string }>;
  payments: Array<{ budgetId: number | null; amount: number }>;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [open, setOpen] = useState(false);
  const current = loaded?.patientId === patientId ? loaded : null;
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    Promise.all([
      fetch(`/api/anamnesis?patientId=${patientId}`, { cache: "no-store", signal: controller.signal }).then(r => r.ok ? r.json() as Promise<{ anamnesis?: unknown }> : { anamnesis: null }).catch(() => ({ anamnesis: null })),
      fetch(`/api/alertas?patientId=${patientId}`, { cache: "no-store", signal: controller.signal }).then(async r => { if (!r.ok) throw new Error(); return r.json() as Promise<{ alerts: ManualAlert[] }>; }).then(d => ({ alerts: d.alerts, error: "" })).catch(() => ({ alerts: [] as ManualAlert[], error: "No se pudieron leer las alertas manuales." })),
    ]).then(([a, m]) => { if (active) setLoaded({ patientId, anamnesis: a.anamnesis ? normalizeAnamnesis(a.anamnesis) : null, alerts: m.alerts, error: m.error }); });
    const onSaved = (event: Event) => {
      const detail = (event as CustomEvent<{ patientId?: number; anamnesis?: unknown }>).detail;
      if (detail?.patientId === patientId) setLoaded(previous => previous && previous.patientId === patientId ? { ...previous, anamnesis: detail.anamnesis ? normalizeAnamnesis(detail.anamnesis) : null } : previous);
    };
    window.addEventListener("patient-anamnesis-saved", onSaved);
    return () => { active = false; controller.abort(); window.removeEventListener("patient-anamnesis-saved", onSaved); };
  }, [patientId]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const medicalAuto = useMemo(() => deriveMedicalAlerts({ anamnesis: current?.anamnesis ?? null, allergies, history }), [current?.anamnesis, allergies, history]);
  const adminAuto = useMemo(() => deriveAdminAlerts(budgets, payments), [budgets, payments]);
  const manual = current?.alerts ?? [];
  const medical = [...medicalAuto.map(a => a.text), ...manual.filter(a => a.kind === "medica").map(a => a.text)];
  const admin = [...adminAuto.map(a => a.text), ...manual.filter(a => a.kind === "administrativa").map(a => a.text)];
  const setAlerts = (update: (alerts: ManualAlert[]) => ManualAlert[]) => setLoaded(previous => previous && previous.patientId === patientId ? { ...previous, alerts: update(previous.alerts) } : previous);

  const chip = (kind: AlertKind, list: string[]) => list.length > 0 && <button type="button" onClick={() => setOpen(value => !value)} aria-expanded={open}
    className={`inline-flex max-w-full min-h-7 items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold ${KIND[kind].chip}`} data-testid={kind === "medica" ? "alert-chip-medica" : "alert-chip-administrativa"}
    title={list.join(" · ")}>
    <AlertTriangle className="size-3.5 shrink-0" aria-hidden="true"/>
    <span className="truncate max-w-[42vw] sm:max-w-[260px]">{list[0]}</span>
    {list.length > 1 && <span className="shrink-0 rounded-full bg-white/80 px-1.5">+{list.length - 1}</span>}
  </button>;

  return <>
    <span className="contents" data-testid="patient-alerts-bar">
      {chip("medica", medical)}
      {chip("administrativa", admin)}
      {current && medical.length === 0 && admin.length === 0 && <button type="button" onClick={() => setOpen(true)} className="inline-flex min-h-7 items-center gap-1 rounded-full border border-dashed border-[#c9c7d6] px-2 text-xs text-[#6b6a7c]" data-testid="alert-chip-none"><Plus className="size-3.5"/>Sin alertas</button>}
    </span>
    {open && <div ref={panelRef} className="absolute inset-x-0 top-full z-20 mt-1 max-h-[70vh] overflow-y-auto rounded-b-xl border border-[#dddbe6] bg-white p-3 shadow-xl md:rounded-xl" role="dialog" aria-label="Alertas del paciente" data-testid="patient-alerts-panel">
      <div className="mb-2 flex items-center justify-between"><p className="text-sm font-semibold text-[#26243a]">Alertas del paciente</p><button type="button" onClick={() => setOpen(false)} className="inline-flex size-9 items-center justify-center rounded-lg hover:bg-[#f3f1f7]" aria-label="Cerrar alertas"><X className="size-4"/></button></div>
      {current?.error && <p role="alert" className="mb-2 text-xs text-amber-900">{current.error}</p>}
      <div className="grid gap-3 md:grid-cols-2">
        <AlertBox kind="medica" patientId={patientId} auto={medicalAuto.map(a => ({ key: a.key, text: a.text, source: a.key === "alergia" ? "Ficha / anamnesis" : "Anamnesis" }))} manual={manual.filter(a => a.kind === "medica")} onChange={setAlerts}/>
        <AlertBox kind="administrativa" patientId={patientId} auto={adminAuto.map(a => ({ key: a.key, text: a.text, source: "Presupuestos" }))} manual={manual.filter(a => a.kind === "administrativa")} onChange={setAlerts}/>
      </div>
    </div>}
  </>;
}

function AlertBox({ kind, patientId, auto, manual, onChange }: {
  kind: AlertKind;
  patientId: number;
  auto: Array<{ key: string; text: string; source: string }>;
  manual: ManualAlert[];
  onChange: (update: (alerts: ManualAlert[]) => ManualAlert[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<{ id: number; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const style = KIND[kind];
  const run = async (work: () => Promise<void>) => { setBusy(true); setError(""); try { await work(); } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar."); } finally { setBusy(false); } };
  const add = () => run(async () => {
    const text = draft.trim(); if (!text) return;
    const { alert } = await call<{ alert: ManualAlert }>("/api/alertas", { method: "POST", body: JSON.stringify({ patientId, kind, text }) });
    onChange(alerts => [...alerts, alert]); setDraft("");
  });
  const save = () => run(async () => {
    if (!editing || !editing.text.trim()) return;
    const { alert } = await call<{ alert: ManualAlert }>("/api/alertas", { method: "PATCH", body: JSON.stringify({ patientId, id: editing.id, text: editing.text }) });
    onChange(alerts => alerts.map(entry => entry.id === alert.id ? alert : entry)); setEditing(null);
  });
  const remove = (alert: ManualAlert) => run(async () => {
    if (!window.confirm(`¿Quitar la alerta «${alert.text.slice(0, 80)}»?`)) return;
    await call("/api/alertas", { method: "DELETE", body: JSON.stringify({ patientId, id: alert.id }) });
    onChange(alerts => alerts.filter(entry => entry.id !== alert.id));
  });
  return <section className={`overflow-hidden rounded-lg border ${style.box}`} data-testid={`alert-box-${kind}`}>
    <h3 className={`px-3 py-1.5 text-sm font-semibold ${style.head}`}>{style.title}</h3>
    <ul className="divide-y divide-[#efeef4] text-sm">
      {auto.map(item => <li key={item.key} className="flex items-start justify-between gap-2 px-3 py-2"><span className="font-medium text-[#26243a]">{item.text}</span><span className="shrink-0 rounded bg-[#f3f1f7] px-1.5 text-[10px] uppercase tracking-wide text-[#6b6a7c]">{item.source}</span></li>)}
      {manual.map(item => <li key={item.id} className="flex items-start justify-between gap-2 px-3 py-2">
        {editing?.id === item.id
          ? <span className="flex w-full flex-col gap-2"><textarea aria-label="Editar alerta" className="min-h-16 w-full rounded-md border border-[#dddbe6] p-2 text-base sm:text-sm" maxLength={ALERT_TEXT_MAX} value={editing.text} onChange={event => setEditing({ id: item.id, text: event.target.value })}/><span className="flex gap-2"><Button type="button" size="sm" disabled={busy} onClick={() => void save()}>Guardar</Button><Button type="button" size="sm" variant="outline" onClick={() => setEditing(null)}>Cancelar</Button></span></span>
          : <><span className="min-w-0 break-words">{item.text}</span><span className="flex shrink-0 gap-1"><button type="button" className="inline-flex size-8 items-center justify-center rounded hover:bg-[#f3f1f7]" aria-label={`Editar alerta «${item.text.slice(0, 40)}»`} onClick={() => setEditing({ id: item.id, text: item.text })}><Pencil className="size-3.5"/></button><button type="button" className="inline-flex size-8 items-center justify-center rounded text-rose-700 hover:bg-rose-50" aria-label={`Quitar alerta «${item.text.slice(0, 40)}»`} disabled={busy} onClick={() => void remove(item)}><Trash2 className="size-3.5"/></button></span></>}
      </li>)}
      {auto.length === 0 && manual.length === 0 && <li className="px-3 py-2 text-xs text-[#6b6a7c]">Sin alertas.</li>}
    </ul>
    <div className="space-y-2 border-t border-[#efeef4] p-2">
      <textarea aria-label={style.placeholder} placeholder={style.placeholder} maxLength={ALERT_TEXT_MAX} className="min-h-14 w-full rounded-md border border-[#dddbe6] p-2 text-base sm:text-sm" value={draft} onChange={event => setDraft(event.target.value)} data-testid={`alert-new-${kind}`}/>
      {error && <p role="alert" className="text-xs text-rose-800">{error}</p>}
      <Button type="button" size="sm" disabled={busy || !draft.trim()} onClick={() => void add()} data-testid={`alert-add-${kind}`}><Plus className="mr-1 size-4"/>Agregar</Button>
    </div>
  </section>;
}
