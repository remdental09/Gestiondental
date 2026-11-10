"use client";
/* eslint-disable @next/next/no-img-element -- Las radiografías son rutas autenticadas que se cargan con la sesión del navegador. */
import { useEffect, useMemo, useRef, useState } from "react";
import { FileText, Plus, Printer, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { ClinicalImage } from "@/app/clinical-data";
import {
  CANAL_NAMES, CASE_TYPES, CORONAL_SEALS, DIFFICULTY, IRRIGANTS, MEDICATIONS, OBTURATION_TECHNIQUES, OUTCOMES, PAI, PERIAPICAL_DX, PULPAL_DX, REFERENCE_POINTS, RX_STAGES, SEALERS, SESSION_STEPS, TESTS,
  canalLine, caseStatus, followUpEvolutionText, missingDocumentation, newCase, sessionEvolutionText, suggestedNextControl,
  type EndoCanal, type EndoCase, type EndoData, type EndoFollowUp, type EndoSession, type EndoStatus,
} from "@/lib/endodontics";

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const fdate = (iso: string) => iso ? iso.split("-").reverse().join("-") : "—";
const fdi = (tooth: number) => `${Math.floor(tooth / 10)}.${tooth % 10}`;
const uid = () => crypto.randomUUID().slice(0, 12);
const mmText = (n: number) => n ? String(n).replace(".", ",") : "";
const PERMANENT = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28, 48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
const PRIMARY = [55, 54, 53, 52, 51, 61, 62, 63, 64, 65, 85, 84, 83, 82, 81, 71, 72, 73, 74, 75];
const SECTIONS = ["Diagnóstico", "Conductos", "Sesiones", "Obturación", "RX", "Controles", "Informe"] as const;
type Section = typeof SECTIONS[number];
const CLOSE_REASONS = ["Derivado a especialista", "Exodoncia indicada", "Paciente no continuó", "Otro"];
const statusStyle: Record<EndoStatus, string> = { "Diagnóstico": "bg-slate-100 text-slate-700", "En curso": "bg-teal-50 text-teal-800 border border-teal-300", "Obturado": "bg-[#0f766e] text-white", "Control atrasado": "bg-rose-50 text-rose-800", "Cerrado": "bg-slate-200 text-slate-600" };
const field = "mt-1 block h-10 w-full rounded-lg border border-[#dddbe6] bg-white px-3 text-base sm:text-sm";
const emptySession = (): EndoSession & { toChart: boolean } => ({ id: "", date: today(), steps: [], irrigants: [], medication: "", temporary: "", notes: "", toChart: true });
const emptyFollow = (): EndoFollowUp & { next: string; toChart: boolean } => ({ id: "", date: today(), pai: 0, symptoms: "", outcome: "", notes: "", next: "", toChart: true });

/** Dibujo esquemático de los conductos: longitud aparente, longitud de trabajo y distancia al ápice. */
function CanalDiagram({ canals }: { canals: EndoCanal[] }) {
  if (!canals.length) return null;
  const max = Math.max(25, ...canals.map(k => Math.max(k.apparentLength, k.workingLength, k.apexLocator)));
  const height = 210, top = 34, scale = (height - top - 20) / max, gap = 78, width = Math.max(260, canals.length * gap + 40);
  return <svg viewBox={`0 0 ${width} ${height}`} className="h-56 w-full max-w-xl" role="img" aria-label="Esquema de conductos con longitud de trabajo">
    <rect x={10} y={8} width={width - 20} height={22} rx={8} fill="#e6e4ee" />
    <text x={width / 2} y={23} textAnchor="middle" fontSize={10} fill="#473a6d">Punto de referencia (corona)</text>
    {canals.map((k, i) => {
      const x = 40 + i * gap, total = (k.apparentLength || k.workingLength || k.apexLocator || 0) * scale, wl = k.workingLength * scale;
      return <g key={k.id}>
        <line x1={x} y1={top} x2={x} y2={top + Math.max(total, 4)} stroke="#d0cadd" strokeWidth={8} strokeLinecap="round" />
        {wl > 0 && <line x1={x} y1={top} x2={x} y2={top + wl} stroke="#0f766e" strokeWidth={4} strokeLinecap="round" />}
        {total > 0 && <circle cx={x} cy={top + total} r={4} fill="#ef895f" />}
        <text x={x} y={height - 6} textAnchor="middle" fontSize={11} fontWeight={700} fill="#2a2540">{k.name || `C${i + 1}`}</text>
        {k.workingLength > 0 && <text x={x + 9} y={top + wl - 2} fontSize={10} fill="#0f766e">LT {mmText(k.workingLength)}</text>}
        {k.apexDistance > 0 && <text x={x + 9} y={top + wl + 11} fontSize={9} fill="#9a4f37">−{mmText(k.apexDistance)} ápice</text>}
      </g>;
    })}
  </svg>;
}

export function EndodonticsPanel({ data: saved, onSave, focusTooth, patientName, images, onUploadImage, onRemoveImage, onAddNote }: {
  data: EndoData;
  onSave: (next: EndoData) => Promise<EndoData>;
  /** Pieza elegida desde el odontograma general. */
  focusTooth?: number | null;
  patientName: string;
  images: ClinicalImage[];
  onUploadImage: (file: File, kind: "RX endodoncia", note: string) => Promise<ClinicalImage>;
  onRemoveImage: (id: number) => Promise<void>;
  onAddNote: (title: string, body: string, clinicalDate: string, link?: { kind: "endo-session" | "endo-followup"; ref: string }) => Promise<void>;
}) {
  // Todos los hooks van aquí arriba: nunca después de un return condicional.
  const [data, setData] = useState<EndoData>(saved);
  const [selectedId, setSelectedId] = useState<string>("");
  const [section, setSection] = useState<Section>("Diagnóstico");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [newTooth, setNewTooth] = useState<number>(focusTooth ?? 36);
  const [newType, setNewType] = useState<string>(CASE_TYPES[0]);
  const [session, setSession] = useState(emptySession);
  const [follow, setFollow] = useState(emptyFollow);
  const [rxStage, setRxStage] = useState<string>(RX_STAGES[0]);
  const [closeReason, setCloseReason] = useState(CLOSE_REASONS[0]);
  const reportRef = useRef<HTMLDivElement | null>(null);
  const dataRef = useRef(data);
  useEffect(() => { dataRef.current = data; }, [data]);

  useEffect(() => { if (!dirty) setData(saved); }, [saved, dirty]);
  useEffect(() => {
    if (!focusTooth) return;
    setNewTooth(focusTooth);
    const existing = [...dataRef.current.cases].reverse().find(c => c.tooth === focusTooth);
    if (existing) { setSelectedId(existing.id); setSection("Diagnóstico"); }
  }, [focusTooth]);

  const imageById = useMemo(() => new Map(images.map(image => [image.id, image])), [images]);
  const current = data.cases.find(c => c.id === selectedId) ?? null;
  const day = today();

  const persist = async (next: EndoData, note = "Guardado.") => {
    setSaving(true); setError("");
    try { const result = await onSave(next); setData(result); setDirty(false); setMessage(note); return result; }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar."); throw e; }
    finally { setSaving(false); }
  };
  const editCase = (patch: Partial<EndoCase> | ((c: EndoCase) => Partial<EndoCase>)) => { setData(d => ({ ...d, cases: d.cases.map(c => c.id === selectedId ? { ...c, ...(typeof patch === "function" ? patch(c) : patch) } : c) })); setDirty(true); setMessage(""); };
  const withCase = (update: (c: EndoCase) => EndoCase): EndoData => ({ ...dataRef.current, cases: dataRef.current.cases.map(c => c.id === selectedId ? update(c) : c) });

  const deleteCase = (c: EndoCase) => {
    const extra = [c.sessions.length && `${c.sessions.length} ${c.sessions.length === 1 ? "sesión" : "sesiones"}`, c.rx.length && `${c.rx.length} RX`].filter(Boolean).join(" y ");
    if (!window.confirm(`¿Desea eliminar este diente (FDI ${fdi(c.tooth)}) del endograma?${extra ? `\n\nSe borrará su ficha con ${extra}.` : ""}\nLas evoluciones ya registradas en la historia clínica no se borran.`)) return;
    const ids = c.rx.map(r => r.imageId);
    void persist({ ...dataRef.current, cases: dataRef.current.cases.filter(x => x.id !== c.id) }, `Pieza ${fdi(c.tooth)} eliminada del endograma.`).then(async () => {
      if (selectedId === c.id) setSelectedId("");
      for (const id of ids) await onRemoveImage(id).catch(() => undefined);
    }).catch(() => undefined);
  };
  const createCase = () => {
    const open = data.cases.find(x => x.tooth === newTooth && !x.closedReason && !x.obturation.date);
    if (open && !window.confirm(`La pieza ${fdi(newTooth)} ya tiene una ficha abierta. ¿Crear otra de todas formas?\n\nPulsa «Cancelar» para abrir la que ya existe.`)) { setSelectedId(open.id); setSection("Diagnóstico"); return; }
    const c = { ...newCase(uid(), newTooth, day), type: newType };
    void persist({ ...data, cases: [...data.cases, c] }, `Ficha endodóntica abierta en FDI ${fdi(newTooth)}.`).then(() => { setSelectedId(c.id); setSection("Diagnóstico"); }).catch(() => undefined);
  };

  /* ───────── Diagnóstico ───────── */
  const renderDiagnosis = (c: EndoCase) => <div className="space-y-4" data-testid="endo-diagnosis">
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-medium">Motivo de consulta<Textarea rows={2} maxLength={1000} className="mt-1 text-base sm:text-sm" value={c.complaint} onChange={e => editCase({ complaint: e.target.value })} placeholder="En palabras del paciente" /></label>
      <label className="text-sm font-medium">Historia del dolor<Textarea rows={2} maxLength={1000} className="mt-1 text-base sm:text-sm" value={c.pain} onChange={e => editCase({ pain: e.target.value })} placeholder="Espontáneo o provocado, duración, irradiación, nocturno…" /></label>
    </div>
    <fieldset className="rounded-xl border border-[#e6e4ee] p-3"><legend className="px-1 text-sm font-semibold">Pruebas clínicas (pieza {fdi(c.tooth)})</legend>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{TESTS.map(t => <label key={t.key} className="text-sm font-medium">{t.label}<select className={field} value={c.tests[t.key]} onChange={e => editCase({ tests: { ...c.tests, [t.key]: e.target.value } })}><option value="">Sin registrar</option>{t.options.map(o => <option key={o}>{o}</option>)}</select></label>)}</div>
      <p className="mt-2 text-xs text-[#6b6a7c]">«Sin registrar» no significa negativo: solo que la prueba no se anotó.</p></fieldset>
    <div className="grid gap-4 sm:grid-cols-3">
      <label className="text-sm font-medium">Diagnóstico pulpar (AAE)<select className={field} value={c.pulpal} onChange={e => editCase({ pulpal: e.target.value })}><option value="">Sin registrar</option>{PULPAL_DX.map(o => <option key={o}>{o}</option>)}</select></label>
      <label className="text-sm font-medium">Diagnóstico periapical (AAE)<select className={field} value={c.periapical} onChange={e => editCase({ periapical: e.target.value })}><option value="">Sin registrar</option>{PERIAPICAL_DX.map(o => <option key={o}>{o}</option>)}</select></label>
      <label className="text-sm font-medium">Dificultad del caso (AAE)<select className={field} value={c.difficulty} onChange={e => editCase({ difficulty: e.target.value })}><option value="">Sin evaluar</option>{DIFFICULTY.map(o => <option key={o}>{o}</option>)}</select></label>
    </div>
    <label className="block text-sm font-medium">Notas diagnósticas<Textarea rows={2} maxLength={2000} className="mt-1 text-base sm:text-sm" value={c.diagnosisNotes} onChange={e => editCase({ diagnosisNotes: e.target.value })} placeholder="Hallazgos radiográficos, fístula, fractura, reabsorción…" /></label>
  </div>;

  /* ───────── Conductos ───────── */
  const setCanal = (_c: EndoCase, id: string, patch: Partial<EndoCanal>) => editCase(c => ({ canals: c.canals.map(k => k.id === id ? { ...k, ...patch } : k) }));
  const num = (value: string) => { const n = Number(value.replace(",", ".")); return Number.isFinite(n) && n >= 0 ? Math.round(n * 10) / 10 : 0; };
  const renderCanals = (c: EndoCase) => <div className="space-y-4" data-testid="endo-canals">
    <p className="text-sm text-[#615f73]">Medidas en milímetros. LT = longitud de trabajo; distancia al ápice = cuánto queda la LT corta del ápice radiográfico.</p>
    <CanalDiagram canals={c.canals} />
    {c.canals.map((k, i) => <div key={k.id} className="rounded-xl border border-[#e6e4ee] p-3" data-testid={`endo-canal-${i}`}>
      <div className="flex items-center justify-between"><strong className="text-sm">Conducto {i + 1}</strong><button type="button" aria-label={`Quitar conducto ${k.name || i + 1}`} className="rounded p-1 text-[#8c4a51] hover:bg-rose-50" onClick={() => editCase({ canals: c.canals.filter(x => x.id !== k.id) })}><Trash2 className="size-4" /></button></div>
      <div className="mt-2 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <label className="text-sm font-medium">Nombre<input list="endo-canal-names" maxLength={30} className={field} value={k.name} onChange={e => setCanal(c, k.id, { name: e.target.value })} placeholder="MV" /></label>
        <label className="text-sm font-medium">Long. aparente (RX)<Input inputMode="decimal" className={field} defaultValue={mmText(k.apparentLength)} onBlur={e => setCanal(c, k.id, { apparentLength: num(e.target.value) })} placeholder="22" /></label>
        <label className="text-sm font-medium">Localizador apical<Input inputMode="decimal" className={field} defaultValue={mmText(k.apexLocator)} onBlur={e => setCanal(c, k.id, { apexLocator: num(e.target.value) })} placeholder="21,5" /></label>
        <label className="text-sm font-medium">Longitud de trabajo<Input inputMode="decimal" className={field} defaultValue={mmText(k.workingLength)} onBlur={e => setCanal(c, k.id, { workingLength: num(e.target.value) })} placeholder="21" /></label>
        <label className="text-sm font-medium">Distancia al ápice<Input inputMode="decimal" className={field} defaultValue={mmText(k.apexDistance)} onBlur={e => setCanal(c, k.id, { apexDistance: num(e.target.value) })} placeholder="1" /></label>
        <label className="text-sm font-medium">Punto de referencia<input list="endo-refs" maxLength={60} className={field} value={k.reference} onChange={e => setCanal(c, k.id, { reference: e.target.value })} /></label>
        <label className="text-sm font-medium">Lima apical maestra<Input maxLength={20} className={field} value={k.masterFile} onChange={e => setCanal(c, k.id, { masterFile: e.target.value })} placeholder="35/.04" /></label>
        <label className="text-sm font-medium">Cono maestro<Input maxLength={20} className={field} value={k.masterCone} onChange={e => setCanal(c, k.id, { masterCone: e.target.value })} placeholder="35/.04" /></label>
        <label className="text-sm font-medium sm:col-span-3 lg:col-span-2">Observación<Input maxLength={500} className={field} value={k.notes} onChange={e => setCanal(c, k.id, { notes: e.target.value })} placeholder="Curvatura, calcificación, escalón…" /></label>
      </div>
    </div>)}
    <datalist id="endo-canal-names">{CANAL_NAMES.map(n => <option key={n} value={n} />)}</datalist>
    <datalist id="endo-refs">{REFERENCE_POINTS.map(n => <option key={n} value={n} />)}</datalist>
    <Button variant="outline" size="sm" disabled={c.canals.length >= 8} onClick={() => editCase({ canals: [...c.canals, { id: uid(), name: "", apparentLength: 0, apexLocator: 0, workingLength: 0, reference: "", apexDistance: 0, masterFile: "", masterCone: "", notes: "" }] })}><Plus className="mr-1 size-4" />Agregar conducto</Button>
  </div>;

  /* ───────── Sesiones ───────── */
  const toggle = (list: string[], value: string, on: boolean) => on ? [...list, value] : list.filter(v => v !== value);
  const saveSession = async (c: EndoCase) => {
    if (!session.date || session.date > day) { setError("Indica la fecha de la sesión; no puede ser futura."); return; }
    const entry: EndoSession = { id: uid(), date: session.date, steps: session.steps, irrigants: session.irrigants, medication: session.medication, temporary: session.temporary, notes: session.notes.trim() };
    const obturated = entry.steps.includes("Obturación") && !c.obturation.date;
    try {
      const next = await persist(withCase(x => ({ ...x, sessions: [...x.sessions, entry].sort((a, b) => a.date.localeCompare(b.date)), ...(obturated ? { obturation: { ...x.obturation, date: entry.date }, nextControlDate: x.nextControlDate || suggestedNextControl(entry.date, 0) } : {}) })), "Sesión guardada.");
      const updated = next.cases.find(x => x.id === c.id) ?? c;
      if (session.toChart) await onAddNote(`Endodoncia · FDI ${fdi(c.tooth)}`, sessionEvolutionText(updated, entry), entry.date, { kind: "endo-session", ref: `${c.id}:${entry.id}` });
      setMessage(`${session.toChart ? "Sesión guardada y registrada en la historia clínica." : "Sesión guardada."}${obturated ? " Se registró la fecha de obturación; completa técnica y sellado en «Obturación»." : ""}`);
      setSession(emptySession());
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar la sesión."); }
  };
  const renderSessions = (c: EndoCase) => <div className="space-y-5" data-testid="endo-sessions">
    <div className="rounded-xl border border-[#e6e4ee] bg-[#f9f9fb] p-4">
      <h4 className="font-semibold">Nueva sesión</h4>
      <label className="mt-3 block max-w-xs text-sm font-medium">Fecha<Input type="date" max={day} className={field} value={session.date} onChange={e => setSession({ ...session, date: e.target.value })} /></label>
      <fieldset className="mt-3"><legend className="text-sm font-medium">Procedimiento</legend><div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{SESSION_STEPS.map(step => <label key={step} className="flex items-center gap-2 rounded-lg border border-[#e6e4ee] bg-white px-3 py-2 text-sm"><input type="checkbox" className="size-4 accent-[#0f766e]" checked={session.steps.includes(step)} onChange={e => setSession({ ...session, steps: toggle(session.steps, step, e.target.checked) })} />{step}</label>)}</div></fieldset>
      <fieldset className="mt-3"><legend className="text-sm font-medium">Irrigación</legend><div className="mt-2 flex flex-wrap gap-2">{IRRIGANTS.map(item => <label key={item} className="flex items-center gap-2 rounded-lg border border-[#e6e4ee] bg-white px-3 py-1.5 text-sm"><input type="checkbox" className="size-4 accent-[#0f766e]" checked={session.irrigants.includes(item)} onChange={e => setSession({ ...session, irrigants: toggle(session.irrigants, item, e.target.checked) })} />{item}</label>)}</div></fieldset>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-medium">Medicación intraconducto<select className={field} value={session.medication} onChange={e => setSession({ ...session, medication: e.target.value })}><option value="">Sin registrar</option>{MEDICATIONS.map(m => <option key={m}>{m}</option>)}</select></label>
        <label className="text-sm font-medium">Sellado de la sesión<select className={field} value={session.temporary} onChange={e => setSession({ ...session, temporary: e.target.value })}><option value="">Sin registrar</option>{CORONAL_SEALS.map(m => <option key={m}>{m}</option>)}</select></label>
      </div>
      <label className="mt-3 block text-sm font-medium">Observaciones<Textarea rows={3} maxLength={4000} className="mt-1 text-base sm:text-sm" value={session.notes} onChange={e => setSession({ ...session, notes: e.target.value })} placeholder="Hallazgos, incidencias, indicaciones…" /></label>
      {session.steps.some(s => s === "Conductometría" || s === "Obturación") && c.canals.every(k => !k.workingLength) && <p className="mt-2 text-sm text-amber-800">Registra la longitud de trabajo de cada conducto en «Conductos» para que quede en la evolución.</p>}
      <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[#0f766e]" checked={session.toChart} onChange={e => setSession({ ...session, toChart: e.target.checked })} />Registrar también como evolución en la historia clínica</label>
      <Button className="mt-3 bg-[#0f766e] hover:bg-[#0b5f58]" disabled={saving || (!session.steps.length && !session.notes.trim())} onClick={() => void saveSession(c)} data-testid="endo-session-save">{saving ? "Guardando…" : "Guardar sesión"}</Button>
    </div>
    {c.sessions.length === 0 ? <p className="rounded-xl border border-dashed border-[#dddbe6] p-5 text-center text-sm text-[#6b6a7c]">Aún no hay sesiones.</p> :
      <ol className="space-y-2">{c.sessions.map((s, i) => <li key={s.id} className="rounded-xl border border-[#e6e4ee] p-3 text-sm">
        <div className="flex items-start justify-between gap-3"><div><strong>Sesión {i + 1}</strong><span className="ml-2 text-[#6b6a7c]">{fdate(s.date)}</span></div><button type="button" aria-label={`Eliminar sesión del ${fdate(s.date)}`} className="rounded p-1 text-[#8c4a51] hover:bg-rose-50" onClick={() => { if (window.confirm("¿Eliminar esta sesión? La evolución ya registrada no se modifica.")) void persist(withCase(x => ({ ...x, sessions: x.sessions.filter(y => y.id !== s.id) })), "Sesión eliminada.").catch(() => undefined); }}><Trash2 className="size-4" /></button></div>
        {s.steps.length > 0 && <p className="mt-1 text-[#57566a]">{s.steps.join(" · ")}</p>}
        <p className="mt-1 text-xs text-[#6b6a7c]">{[s.irrigants.join(", "), s.medication && s.medication !== "Ninguna" && `Medicación: ${s.medication}`, s.temporary && `Sellado: ${s.temporary}`].filter(Boolean).join(" · ")}</p>
        {s.notes && <p className="mt-1">{s.notes}</p>}
      </li>)}</ol>}
  </div>;

  /* ───────── Obturación ───────── */
  const renderObturation = (c: EndoCase) => <div className="space-y-4" data-testid="endo-obturation">
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="text-sm font-medium">Fecha de obturación<Input type="date" max={day} className={field} value={c.obturation.date} onChange={e => editCase({ obturation: { ...c.obturation, date: e.target.value }, nextControlDate: c.nextControlDate || suggestedNextControl(e.target.value, 0) })} /></label>
      <label className="text-sm font-medium">Técnica<select className={field} value={c.obturation.technique} onChange={e => editCase({ obturation: { ...c.obturation, technique: e.target.value } })}><option value="">Sin registrar</option>{OBTURATION_TECHNIQUES.map(o => <option key={o}>{o}</option>)}</select></label>
      <label className="text-sm font-medium">Cemento sellador<select className={field} value={c.obturation.sealer} onChange={e => editCase({ obturation: { ...c.obturation, sealer: e.target.value } })}><option value="">Sin registrar</option>{SEALERS.map(o => <option key={o}>{o}</option>)}</select></label>
      <label className="text-sm font-medium">Sellado coronario<select className={field} value={c.obturation.coronalSeal} onChange={e => editCase({ obturation: { ...c.obturation, coronalSeal: e.target.value } })}><option value="">Sin registrar</option>{CORONAL_SEALS.map(o => <option key={o}>{o}</option>)}</select></label>
      <label className="text-sm font-medium">Próximo control<Input type="date" className={field} value={c.nextControlDate} onChange={e => editCase({ nextControlDate: e.target.value })} /></label>
    </div>
    {c.obturation.date && !c.nextControlDate && <p className="text-sm text-[#615f73]">Sugerido: {fdate(suggestedNextControl(c.obturation.date, c.followUps.length))} (6 y 12 meses, luego anual).</p>}
    <label className="block text-sm font-medium">Notas de obturación<Textarea rows={2} maxLength={2000} className="mt-1 text-base sm:text-sm" value={c.obturation.notes} onChange={e => editCase({ obturation: { ...c.obturation, notes: e.target.value } })} placeholder="Calidad radiográfica, extrusión de sellador, indicación de restauración definitiva…" /></label>
    {c.canals.length > 0 && <div className="rounded-xl border border-[#e6e4ee] p-3 text-sm"><p className="font-semibold">Conductos obturados</p><ul className="mt-1 list-disc pl-5">{c.canals.map(k => <li key={k.id}>{canalLine(k)}</li>)}</ul></div>}
  </div>;

  /* ───────── RX ───────── */
  const uploadRx = async (c: EndoCase, file: File | undefined) => {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp", "application/pdf"].includes(file.type)) { setError("Usa JPG, PNG, WebP o PDF."); return; }
    if (file.size > 12 * 1024 * 1024) { setError("Cada archivo debe pesar menos de 12 MB."); return; }
    setError(""); setSaving(true);
    try {
      const image = await onUploadImage(file, "RX endodoncia", `FDI ${fdi(c.tooth)} · ${rxStage}`);
      await persist(withCase(x => ({ ...x, rx: [...x.rx, { imageId: image.id, stage: rxStage, date: day }] })), "Radiografía guardada.");
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar la radiografía."); setSaving(false); }
  };
  const removeRx = async (imageId: number) => {
    if (!window.confirm("¿Quitar esta radiografía?")) return;
    try { await persist(withCase(x => ({ ...x, rx: x.rx.filter(r => r.imageId !== imageId) })), "Radiografía quitada."); await onRemoveImage(imageId); } catch { /* el error ya se muestra */ }
  };
  const rxThumb = (r: { imageId: number; stage: string; date: string }, removable: boolean) => {
    const image = imageById.get(r.imageId);
    if (!image) return null;
    const pdf = image.contentType === "application/pdf";
    return <figure key={r.imageId} className="overflow-hidden rounded-xl border border-[#e6e4ee] bg-white">
      <a href={image.url} target="_blank" rel="noreferrer" className="block bg-[#111]">{pdf ? <span className="flex aspect-[4/3] items-center justify-center gap-2 bg-[#f7f6fa] text-sm font-medium text-[#473a6d]"><FileText className="size-5" />Abrir PDF</span> : <img src={image.url} alt={`RX ${r.stage}`} className="aspect-[4/3] w-full object-contain" />}</a>
      <figcaption className="flex items-center justify-between gap-2 p-2 text-xs"><span><strong className="text-sm">{r.stage}</strong><span className="block text-[#6b6a7c]">{fdate(r.date)}</span></span>{removable && <button type="button" aria-label={`Quitar RX ${r.stage}`} className="rounded p-1 text-[#8c4a51] hover:bg-rose-50" onClick={() => void removeRx(r.imageId)}><Trash2 className="size-4" /></button>}</figcaption>
    </figure>;
  };
  const renderRx = (c: EndoCase) => <div className="space-y-4" data-testid="endo-rx">
    <p className="text-sm text-[#615f73]">Secuencia radiográfica del caso: diagnóstica, conductometría, cono maestro, obturación y controles. No aparecen en la pestaña Imágenes.</p>
    <div className="flex flex-wrap items-end gap-3"><label className="text-sm font-medium">Etapa<select className={field + " min-w-48"} value={rxStage} onChange={e => setRxStage(e.target.value)}>{RX_STAGES.map(s => <option key={s}>{s}</option>)}</select></label>
      <label className="inline-flex h-10 cursor-pointer items-center rounded-lg bg-[#0f766e] px-4 text-sm font-semibold text-white hover:bg-[#0b5f58]">Subir RX<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" disabled={saving} aria-label="Subir radiografía endodóntica" onChange={e => { const file = e.target.files?.[0]; e.target.value = ""; void uploadRx(c, file); }} /></label></div>
    <div className="grid gap-2 sm:grid-cols-5">{RX_STAGES.filter(s => s !== "CBCT").map(stage => { const has = c.rx.some(r => r.stage === stage); return <span key={stage} className={`rounded-lg px-2 py-1.5 text-center text-xs font-semibold ${has ? "bg-teal-50 text-teal-800" : "bg-slate-50 text-slate-500"}`}>{has ? "✓ " : ""}{stage}</span>; })}</div>
    {c.rx.length === 0 ? <p className="rounded-xl border border-dashed border-[#dddbe6] p-5 text-center text-sm text-[#6b6a7c]">Aún no hay radiografías de este caso.</p> :
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[...c.rx].sort((a, b) => RX_STAGES.indexOf(a.stage as typeof RX_STAGES[number]) - RX_STAGES.indexOf(b.stage as typeof RX_STAGES[number]) || a.date.localeCompare(b.date)).map(r => rxThumb(r, true))}</div>}
  </div>;

  /* ───────── Controles ───────── */
  const saveFollow = async (c: EndoCase) => {
    if (!follow.date || follow.date > day) { setError("Indica la fecha del control; no puede ser futura."); return; }
    const entry: EndoFollowUp = { id: uid(), date: follow.date, pai: follow.pai, symptoms: follow.symptoms, outcome: follow.outcome, notes: follow.notes.trim() };
    try {
      const next = await persist(withCase(x => ({ ...x, followUps: [...x.followUps, entry].sort((a, b) => a.date.localeCompare(b.date)), nextControlDate: follow.next })), "Control guardado.");
      const updated = next.cases.find(x => x.id === c.id) ?? c;
      if (follow.toChart) await onAddNote(`Control endodóntico · FDI ${fdi(c.tooth)}`, followUpEvolutionText(updated, entry, follow.next), entry.date, { kind: "endo-followup", ref: `${c.id}:${entry.id}` });
      setMessage(follow.toChart ? "Control guardado y registrado en la historia clínica." : "Control guardado.");
      setFollow(emptyFollow());
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar el control."); }
  };
  const renderFollowUps = (c: EndoCase) => <div className="space-y-5" data-testid="endo-followups">
    {!c.obturation.date && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">El caso aún no tiene fecha de obturación; los controles de cicatrización se cuentan desde ella.</p>}
    <div className="rounded-xl border border-[#e6e4ee] bg-[#f9f9fb] p-4">
      <h4 className="font-semibold">Nuevo control</h4>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <label className="text-sm font-medium">Fecha<Input type="date" max={day} className={field} value={follow.date} onChange={e => setFollow({ ...follow, date: e.target.value })} /></label>
        <label className="text-sm font-medium">Síntomas<select className={field} value={follow.symptoms} onChange={e => setFollow({ ...follow, symptoms: e.target.value })}><option value="">Sin registrar</option><option>Asintomático</option><option>Sintomático</option></select></label>
        <label className="text-sm font-medium">Índice periapical (PAI)<select className={field} value={follow.pai || ""} onChange={e => setFollow({ ...follow, pai: Number(e.target.value) || 0 })}><option value="">Sin registrar</option>{PAI.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}</select></label>
        <label className="text-sm font-medium">Evolución<select className={field} value={follow.outcome} onChange={e => setFollow({ ...follow, outcome: e.target.value })}><option value="">Sin registrar</option>{OUTCOMES.map(o => <option key={o}>{o}</option>)}</select></label>
        <label className="text-sm font-medium">Próximo control<Input type="date" className={field} value={follow.next} onChange={e => setFollow({ ...follow, next: e.target.value })} /></label>
        {c.obturation.date && <button type="button" className="self-end pb-2 text-left text-xs font-semibold text-[#0f766e] underline" onClick={() => setFollow({ ...follow, next: suggestedNextControl(c.obturation.date, c.followUps.length + 1) })}>Usar control sugerido ({fdate(suggestedNextControl(c.obturation.date, c.followUps.length + 1)) || "sin más controles"})</button>}
      </div>
      <label className="mt-3 block text-sm font-medium">Observaciones<Textarea rows={2} maxLength={2000} className="mt-1 text-base sm:text-sm" value={follow.notes} onChange={e => setFollow({ ...follow, notes: e.target.value })} /></label>
      <label className="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" className="size-4 accent-[#0f766e]" checked={follow.toChart} onChange={e => setFollow({ ...follow, toChart: e.target.checked })} />Registrar también como evolución en la historia clínica</label>
      <p className="mt-2 text-xs text-[#6b6a7c]">Sube la RX del control en la sección «RX» con la etapa «Control».</p>
      <Button className="mt-3 bg-[#0f766e] hover:bg-[#0b5f58]" disabled={saving} onClick={() => void saveFollow(c)} data-testid="endo-follow-save">{saving ? "Guardando…" : "Guardar control"}</Button>
    </div>
    {c.followUps.length > 0 && <ul className="space-y-2">{c.followUps.map(f => <li key={f.id} className="rounded-xl border border-[#e6e4ee] p-3 text-sm"><div className="flex justify-between gap-3"><strong>{fdate(f.date)}</strong><button type="button" aria-label={`Eliminar control del ${fdate(f.date)}`} className="rounded p-1 text-[#8c4a51] hover:bg-rose-50" onClick={() => { if (window.confirm("¿Eliminar este control?")) void persist(withCase(x => ({ ...x, followUps: x.followUps.filter(y => y.id !== f.id) })), "Control eliminado.").catch(() => undefined); }}><Trash2 className="size-4" /></button></div><p className="mt-1 text-[#57566a]">{[f.symptoms, f.pai && `PAI ${f.pai}`, f.outcome].filter(Boolean).join(" · ") || "Sin datos"}</p>{f.notes && <p className="mt-1">{f.notes}</p>}</li>)}</ul>}
  </div>;

  /* ───────── Informe ───────── */
  const printReport = () => {
    const node = reportRef.current;
    if (!node) return;
    const win = window.open("", "_blank", "width=900,height=1100");
    if (!win) { setError("El navegador bloqueó la ventana de impresión."); return; }
    win.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Informe endodóntico</title><style>body{font-family:system-ui,sans-serif;color:#2a2540;margin:24px;font-size:13px}h1{font-size:20px;margin:0 0 4px}h2{font-size:15px;margin:18px 0 6px;color:#0f766e;border-bottom:1px solid #dddbe6;padding-bottom:3px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #dddbe6;padding:4px 6px;text-align:left;font-size:12px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}figure{margin:0;break-inside:avoid}img{width:100%;max-height:240px;object-fit:contain;background:#111}figcaption{font-size:11px}.muted{color:#6b6a7c}</style></head><body>${node.innerHTML}</body></html>`);
    win.document.close();
    win.onload = () => win.print();
  };
  const renderReport = (c: EndoCase) => {
    const missing = missingDocumentation(c);
    return <div className="space-y-4" data-testid="endo-report">
      <div className="flex flex-wrap items-center gap-3"><Button className="bg-[#0f766e] hover:bg-[#0b5f58]" onClick={printReport}><Printer className="mr-2 size-4" />Imprimir o guardar PDF</Button>{missing.length > 0 && <span className="text-sm text-amber-800">Faltan: {missing.join(", ")}.</span>}</div>
      <div ref={reportRef} className="rounded-xl border border-[#e6e4ee] bg-white p-5 text-sm">
        <h1 className="text-lg font-semibold">Informe endodóntico · pieza {fdi(c.tooth)}</h1>
        <p className="muted text-[#6b6a7c]">{patientName} · {c.type} · ficha abierta el {fdate(c.openedOn)}</p>
        <h2 className="mt-4 font-semibold text-[#0f766e]">Diagnóstico</h2>
        <p>{[c.pulpal && `Pulpar: ${c.pulpal}`, c.periapical && `Periapical: ${c.periapical}`, c.difficulty && `Dificultad: ${c.difficulty}`].filter(Boolean).join(" · ") || "Sin registrar"}</p>
        {c.complaint && <p>Motivo: {c.complaint}</p>}{c.pain && <p>Dolor: {c.pain}</p>}
        {Object.values(c.tests).some(Boolean) && <p>Pruebas: {TESTS.filter(t => c.tests[t.key]).map(t => `${t.label.toLowerCase()} ${c.tests[t.key].toLowerCase()}`).join("; ")}.</p>}
        {c.diagnosisNotes && <p>{c.diagnosisNotes}</p>}
        <h2 className="mt-4 font-semibold text-[#0f766e]">Conductos</h2>
        {c.canals.length ? <table className="mt-1 w-full text-left text-xs"><thead><tr><th>Conducto</th><th>Long. aparente</th><th>Localizador</th><th>LT</th><th>Referencia</th><th>Al ápice</th><th>LAM</th><th>Cono</th></tr></thead><tbody>{c.canals.map(k => <tr key={k.id}><td>{k.name}</td><td>{mmText(k.apparentLength) && `${mmText(k.apparentLength)} mm`}</td><td>{mmText(k.apexLocator) && `${mmText(k.apexLocator)} mm`}</td><td>{mmText(k.workingLength) && `${mmText(k.workingLength)} mm`}</td><td>{k.reference}</td><td>{mmText(k.apexDistance) && `${mmText(k.apexDistance)} mm`}</td><td>{k.masterFile}</td><td>{k.masterCone}</td></tr>)}</tbody></table> : <p>Sin registrar</p>}
        <h2 className="mt-4 font-semibold text-[#0f766e]">Sesiones</h2>
        {c.sessions.length ? <ol className="list-decimal pl-5">{c.sessions.map(s => <li key={s.id}>{fdate(s.date)}: {[s.steps.join(", "), s.irrigants.length && `irrigación ${s.irrigants.join(", ")}`, s.medication && s.medication !== "Ninguna" && `medicación ${s.medication.toLowerCase()}`, s.temporary && `sellado ${s.temporary}`, s.notes].filter(Boolean).join("; ")}</li>)}</ol> : <p>Sin sesiones</p>}
        <h2 className="mt-4 font-semibold text-[#0f766e]">Obturación</h2>
        <p>{c.obturation.date ? [fdate(c.obturation.date), c.obturation.technique, c.obturation.sealer && `cemento ${c.obturation.sealer}`, c.obturation.coronalSeal && `sellado coronario: ${c.obturation.coronalSeal}`, c.obturation.notes].filter(Boolean).join(" · ") : "Pendiente"}</p>
        <h2 className="mt-4 font-semibold text-[#0f766e]">Controles</h2>
        {c.followUps.length ? <ul className="list-disc pl-5">{c.followUps.map(f => <li key={f.id}>{fdate(f.date)}: {[f.symptoms, f.pai && `PAI ${f.pai}`, f.outcome, f.notes].filter(Boolean).join(" · ")}</li>)}</ul> : <p>Sin controles</p>}
        {c.nextControlDate && <p>Próximo control: {fdate(c.nextControlDate)}</p>}
        {c.closedReason && <p>Caso cerrado: {c.closedReason}</p>}
        <h2 className="mt-4 font-semibold text-[#0f766e]">Radiografías</h2>
        {c.rx.length ? <div className="grid mt-2 grid-cols-2 gap-3 sm:grid-cols-3">{[...c.rx].sort((a, b) => RX_STAGES.indexOf(a.stage as typeof RX_STAGES[number]) - RX_STAGES.indexOf(b.stage as typeof RX_STAGES[number])).map(r => { const image = imageById.get(r.imageId); return image && image.contentType !== "application/pdf" ? <figure key={r.imageId}><img src={image.url} alt={`RX ${r.stage}`} className="w-full bg-[#111] object-contain" /><figcaption>{r.stage} · {fdate(r.date)}</figcaption></figure> : null; })}</div> : <p>Sin radiografías</p>}
      </div>
    </div>;
  };

  /* ───────── Vista general ───────── */
  const casesSorted = [...data.cases].sort((a, b) => b.openedOn.localeCompare(a.openedOn));
  const teethOptions = newTooth > 50 ? PRIMARY : PERMANENT;
  const saveBar = (c: EndoCase) => (section === "Diagnóstico" || section === "Conductos" || section === "Obturación") && <div className="sticky bottom-2 z-10 flex flex-wrap items-center gap-3 rounded-xl border border-[#e6e4ee] bg-white/95 p-3 shadow-sm backdrop-blur">
    <Button className="bg-[#0f766e] hover:bg-[#0b5f58]" disabled={saving || !dirty} onClick={() => void persist(data, `Ficha FDI ${fdi(c.tooth)} guardada.`).catch(() => undefined)} data-testid="endo-save">{saving ? "Guardando…" : "Guardar cambios"}</Button>
    {dirty && <span className="text-sm text-amber-800">Hay cambios sin guardar.</span>}
  </div>;

  return <div className="surface space-y-5" data-testid="endo-panel">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold">Endograma</h3><p className="mt-1 text-sm text-[#615f73]">Ficha endodóntica por pieza: diagnóstico AAE, conductos y medidas, sesiones, obturación, RX y controles. En el odontograma general solo aparece la marca «Endo».</p></div></div>
    {error && <p role="alert" className="text-sm font-medium text-[#a43542]">{error}</p>}
    {message && !error && <p role="status" className="text-sm font-medium text-[#0f766e]">{message}</p>}

    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
      <div className="flex gap-2 overflow-x-auto pb-1" role="list" aria-label="Fichas endodónticas">
        {casesSorted.length === 0 && <p className="text-sm text-[#6b6a7c]">Este paciente aún no tiene fichas endodónticas.</p>}
        {casesSorted.map(c => { const status = caseStatus(c, day); const missing = missingDocumentation(c).length; return <div key={c.id} role="listitem" className="relative shrink-0"><button type="button" aria-label={`Abrir ficha FDI ${fdi(c.tooth)}`} onClick={() => { if (dirty && !window.confirm("Hay cambios sin guardar. ¿Cambiar de ficha y descartarlos?")) return; setData(saved); setDirty(false); setSelectedId(c.id); setSection("Diagnóstico"); setMessage(""); setError(""); }} className={`rounded-xl border py-2 pl-3 pr-9 text-left ${c.id === selectedId ? "border-[#0f766e] bg-teal-50/60 ring-1 ring-[#0f766e]" : "border-[#e6e4ee] bg-white hover:bg-[#f9f9fb]"}`} data-testid={`endo-case-${c.tooth}`}>
          <span className="block text-base font-semibold">FDI {fdi(c.tooth)}</span>
          <span className="block text-xs text-[#615f73]">{c.type}</span>
          <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusStyle[status]}`}>{status}</span>
          {missing > 0 && <span className="ml-1 text-[11px] text-amber-800">{missing} pendientes</span>}
        </button><button type="button" aria-label={`Eliminar pieza ${fdi(c.tooth)} del endograma`} title="Eliminar este diente" disabled={saving} onClick={() => deleteCase(c)} className="absolute right-1.5 top-1.5 rounded-md p-1.5 text-[#8c4a51] hover:bg-rose-50 disabled:opacity-40" data-testid={`endo-delete-${c.tooth}`}><Trash2 className="size-4" /></button></div>; })}
      </div>
      <div className="flex flex-wrap items-end gap-2 rounded-xl border border-[#e6e4ee] p-2">
        <label className="text-xs font-medium">Pieza<select className={field + " h-9"} value={newTooth} onChange={e => setNewTooth(Number(e.target.value))}>{[...PERMANENT, ...PRIMARY].map(t => <option key={t} value={t}>{fdi(t)}</option>)}</select></label>
        <label className="text-xs font-medium">Tipo<select className={field + " h-9 max-w-52"} value={newType} onChange={e => setNewType(e.target.value)}>{CASE_TYPES.map(t => <option key={t}>{t}</option>)}</select></label>
        <Button size="sm" className="h-9 bg-[#0f766e] hover:bg-[#0b5f58]" disabled={saving || !teethOptions.length} onClick={createCase} data-testid="endo-new-case"><Plus className="mr-1 size-4" />Nueva ficha</Button>
      </div>
    </div>

    {current ? <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3"><h4 className="text-lg font-semibold">Pieza {fdi(current.tooth)} · {current.type}</h4><span className={`rounded-full px-3 py-1 text-xs font-semibold ${statusStyle[caseStatus(current, day)]}`}>{caseStatus(current, day)}</span>
        {current.nextControlDate && <span className="text-sm text-[#615f73]">Próximo control: {fdate(current.nextControlDate)}</span>}<Button variant="outline" size="sm" className="ml-auto border-rose-200 text-[#a43542] hover:bg-rose-50" disabled={saving} onClick={() => deleteCase(current)} data-testid="endo-delete-current"><Trash2 className="mr-1 size-4" />Eliminar diente</Button></div>
      {(() => { const missing = missingDocumentation(current); return missing.length > 0 && <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950" data-testid="endo-missing">Para que el caso quede bien documentado falta: {missing.join(", ")}.</p>; })()}
      <div role="tablist" aria-label="Secciones del endograma" className="flex gap-1 overflow-x-auto rounded-xl border border-[#dddbe6] bg-[#f4fbfa] p-1">{SECTIONS.map(name => <button key={name} type="button" role="tab" aria-selected={section === name} onClick={() => setSection(name)} className={`shrink-0 rounded-lg px-3 py-2 text-sm font-semibold ${section === name ? "bg-white text-[#0f766e] shadow-sm" : "text-[#615f73]"}`}>{name}{name === "RX" && current.rx.length ? ` (${current.rx.length})` : ""}</button>)}</div>
      {section === "Diagnóstico" && renderDiagnosis(current)}
      {section === "Conductos" && renderCanals(current)}
      {section === "Sesiones" && renderSessions(current)}
      {section === "Obturación" && renderObturation(current)}
      {section === "RX" && renderRx(current)}
      {section === "Controles" && renderFollowUps(current)}
      {section === "Informe" && renderReport(current)}
      {saveBar(current)}
      <details className="rounded-xl border border-[#e6e4ee] p-3 text-sm"><summary className="cursor-pointer font-semibold text-[#57566a]">Cerrar o eliminar la ficha de esta pieza</summary>
        <div className="mt-3 flex flex-wrap items-end gap-3">
          {current.closedReason ? <Button variant="outline" size="sm" disabled={saving} onClick={() => void persist(withCase(x => ({ ...x, closedReason: "" })), "Ficha reabierta.").catch(() => undefined)}>Reabrir ficha</Button> : <>
            <label className="text-sm font-medium">Motivo<select className={field + " h-9"} value={closeReason} onChange={e => setCloseReason(e.target.value)}>{CLOSE_REASONS.map(r => <option key={r}>{r}</option>)}</select></label>
            <Button variant="outline" size="sm" disabled={saving} onClick={() => void persist(withCase(x => ({ ...x, closedReason: closeReason })), "Ficha cerrada.").catch(() => undefined)}>Cerrar ficha</Button></>}
          <Button variant="ghost" size="sm" className="text-[#a43542]" disabled={saving} onClick={() => deleteCase(current)}><Trash2 className="mr-1 size-4" />Eliminar este diente</Button>
        </div></details>
    </div> : casesSorted.length > 0 && <p className="text-sm text-[#6b6a7c]">Elige una ficha para verla.</p>}
  </div>;
}
