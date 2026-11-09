"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, HeartPulse, Loader2, Mic, Pill, Plus, Sparkles, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HoverCard, HoverCardContent, HoverCardTrigger } from "@/components/ui/hover-card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createAudioTranscription } from "@/lib/dictation/audio-transcription";
import { anamnesisAlerts, anamnesisSummary, CONDITIONS, emptyAnamnesis, mergeAnamnesis, type Anamnesis, type ConditionId, type YesNo } from "@/lib/anamnesis";

const req = async (url: string, init?: RequestInit) => {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
  const data = await r.json().catch(() => ({})) as { anamnesis?: Anamnesis | null; error?: string };
  if (!r.ok) throw new Error(data.error || "No se pudo completar la acción.");
  return data.anamnesis ?? null;
};

/** Botón rojo destacado «Anamnesis» + resumen de alertas; abre el formulario dictable. */
export function AnamnesisButton({ patientId, patientName }: { patientId: number; patientName: string }) {
  const [open, setOpen] = useState(false);
  const [peek, setPeek] = useState(false);
  const [origin, setOrigin] = useState({ x: 0, y: 0 });
  const [touch, setTouch] = useState(false);
  const [saved, setSaved] = useState<Anamnesis | null>(null);
  useEffect(() => { let live = true; setSaved(null); req(`/api/anamnesis?patientId=${patientId}`).then(a => { if (live) setSaved(a); }).catch(() => undefined); return () => { live = false; }; }, [patientId]);
  // Celular o tableta: no hay «pasar el mouse», así que un toque despliega el resumen y desde ahí se edita.
  useEffect(() => { const q = window.matchMedia("(hover: none)"); const sync = () => setTouch(q.matches); sync(); q.addEventListener("change", sync); return () => q.removeEventListener("change", sync); }, []);
  const alerts = saved ? anamnesisAlerts(saved) : [];
  const summary = saved ? anamnesisSummary(saved) : [];
  const trigger = (onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void) => <Button type="button" onClick={onClick} data-testid="anamnesis-button" className="h-11 shrink-0 gap-2 rounded-xl bg-[#d62839] px-5 font-semibold text-white shadow-md hover:bg-[#b81f2f]">
    <HeartPulse className="size-5" />Anamnesis{alerts.length > 0 && <span className="rounded-full bg-white px-2 text-xs font-bold text-[#d62839]">{alerts.length}</span>}
  </Button>;
  const panelClass = "max-h-[70vh] w-96 max-w-[92vw] overflow-y-auto border-[#f0b7bd] bg-white";
  const panel = <>
    <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-[#b81f2f]"><HeartPulse className="size-4" />Anamnesis · {patientName}</p>
    {alerts.length > 0 && <ul className="mb-2 list-disc rounded-lg border border-[#d62839] bg-[#fff0f1] py-2 pl-6 pr-2 text-xs font-medium text-[#8f1a27]">{alerts.map(a => <li key={a}>{a}</li>)}</ul>}
    {summary.length ? <dl className="space-y-1.5 text-sm">{summary.map(([k, v]) => <div key={k}><dt className="text-[11px] font-semibold uppercase tracking-wide text-[#6e6a8c]">{k}</dt><dd className="text-[#1f1b3a]">{v}</dd></div>)}</dl>
      : <p className="text-sm text-[#625e82]">{saved ? "Sin datos registrados." : "Aún no hay anamnesis registrada."}</p>}
  </>;
  return <>
    {touch
      ? trigger(e => { const r = e.currentTarget.getBoundingClientRect(); setOrigin({ x: r.left + r.width / 2, y: r.top + r.height / 2 }); setPeek(true); })
      : <HoverCard openDelay={80} closeDelay={120}>
          <HoverCardTrigger asChild>{trigger(() => setOpen(true))}</HoverCardTrigger>
          <HoverCardContent align="end" className={panelClass} data-testid="anamnesis-hover">
            {panel}
            <p className="mt-2 text-xs text-[#6e6a8c]">Haz clic para {summary.length ? "editar o dictar" : "registrarla o dictarla"}.</p>
          </HoverCardContent>
        </HoverCard>}
    {peek && <AnamnesisReveal patientName={patientName} saved={saved} origin={origin} onClose={() => setPeek(false)} onAdd={() => { setPeek(false); setOpen(true); }} />}
    {open && <AnamnesisDialog patientId={patientId} patientName={patientName} initial={saved} onClose={() => setOpen(false)} onSaved={setSaved} />}
  </>;
}

const REVEAL_CSS = `
@keyframes anam-funnel{0%{opacity:0;transform:translate(var(--dx),var(--dy)) scale(.08,.03);border-radius:999px;filter:blur(10px)}
 55%{opacity:1;filter:blur(2px)}100%{opacity:1;transform:none;border-radius:28px;filter:none}}
@keyframes anam-fade{from{opacity:0}to{opacity:1}}
@keyframes anam-rise{from{opacity:0;transform:translateY(18px) scale(.97)}to{opacity:1;transform:none}}
.anam-back{animation:anam-fade .35s ease-out both}
.anam-panel{animation:anam-funnel .62s cubic-bezier(.16,1,.3,1) both}
.anam-item{animation:anam-rise .5s cubic-bezier(.16,1,.3,1) both;animation-delay:calc(.28s + var(--i) * 85ms)}
@media (prefers-reduced-motion:reduce){.anam-back,.anam-panel,.anam-item{animation:none}}`;

/** Al tocar en celular: el resumen «sale» del botón como en una presentación y destaca lo que más importa. */
function AnamnesisReveal({ patientName, saved, origin, onClose, onAdd }: { patientName: string; saved: Anamnesis | null; origin: { x: number; y: number }; onClose: () => void; onAdd: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [vars, setVars] = useState<React.CSSProperties>({ opacity: 0 });
  useLayoutEffect(() => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setVars({ "--dx": `${origin.x - (r.left + r.width / 2)}px`, "--dy": `${origin.y - (r.top + r.height / 2)}px` } as React.CSSProperties);
  }, [origin]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", key);
    return () => { window.removeEventListener("keydown", key); document.body.style.overflow = prev; };
  }, [onClose]);
  const alerts = saved ? anamnesisAlerts(saved) : [];
  const rest = (saved ? anamnesisSummary(saved) : []).filter(([k]) => k !== "Alergias" && k !== "Medicamentos");
  const meds = saved?.medications ?? "";
  const first = patientName.split(/\s+/)[0];
  let i = 0;
  const idx = () => ({ "--i": i++ }) as React.CSSProperties;
  if (typeof document === "undefined") return null;
  return createPortal(<div className="fixed inset-0 z-[70]" role="dialog" aria-modal="true" aria-label="Resumen de anamnesis" data-testid="anamnesis-reveal">
    <style>{REVEAL_CSS}</style>
    <div className="anam-back absolute inset-0 bg-[#1a0f2e]/60 backdrop-blur-md" onClick={onClose} />
    <div ref={ref} style={vars} className="anam-panel absolute inset-x-3 top-[7vh] mx-auto flex max-h-[86vh] max-w-lg flex-col overflow-hidden bg-white shadow-2xl ring-1 ring-black/5">
      <div className="flex items-start justify-between gap-3 bg-gradient-to-br from-[#d62839] to-[#8f1a27] px-5 pb-4 pt-5 text-white">
        <div style={idx()} className="anam-item"><p className="text-xs font-semibold uppercase tracking-widest text-white/75">Anamnesis</p>
          <h2 className="text-2xl font-semibold leading-tight">{alerts.length ? `Lo que debes saber de ${first}` : `${first}: sin alertas críticas`}</h2></div>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="rounded-full bg-white/20 p-2"><X className="size-5" /></button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {alerts.map(a => <div key={a} style={idx()} className="anam-item flex items-start gap-3 rounded-2xl border border-[#f0b7bd] bg-[#fff0f1] p-4"><AlertTriangle className="mt-0.5 size-6 shrink-0 text-[#d62839]" /><p className="text-lg font-semibold leading-snug text-[#8f1a27]">{a}</p></div>)}
        {!alerts.length && <div style={idx()} className="anam-item rounded-2xl border border-[#d9efe0] bg-[#f1fbf4] p-4 text-base font-medium text-[#1d6b3a]">{saved ? "No hay alergias ni condiciones de riesgo registradas." : "Aún no hay anamnesis registrada."}</div>}
        {meds && <div style={idx()} className="anam-item flex items-start gap-3 rounded-2xl border border-[#ddd6f0] bg-[#f7f4fe] p-4"><Pill className="mt-0.5 size-5 shrink-0 text-[#4b2a99]" /><div><p className="text-[11px] font-semibold uppercase tracking-wide text-[#6e6a8c]">Medicamentos</p><p className="text-base text-[#1f1b3a]">{meds}</p></div></div>}
        {rest.map(([k, v]) => <div key={k} style={idx()} className="anam-item rounded-xl border border-[#ebe6f6] px-4 py-3"><p className="text-[11px] font-semibold uppercase tracking-wide text-[#6e6a8c]">{k}</p><p className="text-base text-[#1f1b3a]">{v}</p></div>)}
      </div>
      <div style={idx()} className="anam-item flex gap-2 border-t border-[#ebe6f6] bg-white p-4">
        <Button type="button" onClick={onAdd} data-testid="anamnesis-edit" className="h-12 flex-1 gap-2 rounded-xl bg-[#d62839] text-base font-semibold text-white hover:bg-[#b81f2f]"><Plus className="size-5" />Agregar antecedentes</Button>
      </div>
    </div>
  </div>, document.body);
}

function Yn({ label, value, onChange }: { label: string; value: YesNo; onChange: (v: YesNo) => void }) {
  return <div className="flex items-center justify-between gap-3 rounded-lg border border-[#ddd6f0] bg-white px-3 py-2"><span className="text-sm">{label}</span>
    <div className="flex gap-1">{(["si", "no"] as const).map(v => <button key={v} type="button" onClick={() => onChange(value === v ? "" : v)} aria-pressed={value === v}
      className={`rounded-md border px-3 py-1 text-xs font-semibold ${value === v ? (v === "si" ? "border-[#d62839] bg-[#d62839] text-white" : "border-[#4b2a99] bg-[#4b2a99] text-white") : "border-[#ddd6f0] bg-white text-[#3d2f73]"}`}>{v === "si" ? "Sí" : "No"}</button>)}</div></div>;
}
const L = ({ label, children }: { label: string; children: React.ReactNode }) => <label className="block space-y-1"><span className="text-sm font-medium text-[#3d2f73]">{label}</span>{children}</label>;

function AnamnesisDialog({ patientId, patientName, initial, onClose, onSaved }: { patientId: number; patientName: string; initial: Anamnesis | null; onClose: () => void; onSaved: (a: Anamnesis) => void }) {
  const [form, setForm] = useState<Anamnesis>(initial ?? emptyAnamnesis());
  const [transcript, setTranscript] = useState("");
  const [status, setStatus] = useState<"idle" | "starting" | "recording" | "transcribing" | "error">("idle");
  const [organizing, setOrganizing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(""), [notice, setNotice] = useState("");
  const engine = useRef(createAudioTranscription());
  useEffect(() => { const e = engine.current; return () => e.abort(); }, []);
  const set = <K extends keyof Anamnesis>(key: K, value: Anamnesis[K]) => setForm(f => ({ ...f, [key]: value }));
  const toggle = (id: ConditionId) => setForm(f => ({ ...f, conditions: f.conditions.includes(id) ? f.conditions.filter(c => c !== id) : [...f.conditions, id] }));

  const record = () => {
    setError(""); setNotice("");
    if (status === "recording") { engine.current.stop(); return; }
    if (!engine.current.isSupported()) { setError(engine.current.unsupportedMessage()); return; }
    engine.current.start(transcript, {
      onTranscript: text => setTranscript(text), onError: message => { setError(message); setStatus("error"); }, onEnd: () => setStatus("idle"), onStatus: setStatus,
    });
  };
  const organize = useCallback(async () => {
    setError(""); setNotice(""); setOrganizing(true);
    try {
      const patch = await req("/api/anamnesis", { method: "POST", body: JSON.stringify({ transcript }) });
      if (patch) { setForm(f => mergeAnamnesis(f, patch)); setNotice("Dictado ordenado en el formulario. Revísalo y pulsa Guardar."); }
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo ordenar el dictado."); }
    finally { setOrganizing(false); }
  }, [transcript]);
  const save = async () => {
    setError(""); setNotice(""); setSaving(true);
    try { const a = await req("/api/anamnesis", { method: "PUT", body: JSON.stringify({ patientId, anamnesis: form }) }); if (a) { onSaved(a); setNotice("Anamnesis guardada."); } }
    catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo guardar."); }
    finally { setSaving(false); }
  };
  const alerts = anamnesisAlerts(form);
  const busy = status === "starting" || status === "transcribing";

  return <Dialog open onOpenChange={v => { if (!v) { engine.current.abort(); onClose(); } }}>
    <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-3xl" data-testid="anamnesis-dialog">
      <DialogHeader><DialogTitle className="flex items-center gap-2 text-[#b81f2f]"><HeartPulse className="size-5" />Anamnesis médico-odontológica</DialogTitle>
        <DialogDescription>Paciente: <strong>{patientName}</strong>{form.updatedAt ? ` · última actualización ${new Date(form.updatedAt).toLocaleDateString("es-CL")}` : " · aún sin registrar"}</DialogDescription></DialogHeader>

      <div className="space-y-2 rounded-xl border border-[#f0b7bd] bg-[#fff5f6] p-3">
        <p className="text-sm font-semibold text-[#b81f2f]">Dictar anamnesis</p>
        <p className="text-xs text-[#625e82]">Pulsa el micrófono y cuenta alergias, enfermedades, medicamentos, cirugías, hábitos y antecedentes dentales. Luego «Ordenar en el formulario».</p>
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={record} disabled={busy} data-testid="anamnesis-dictate" className={status === "recording" ? "bg-[#d62839] text-white hover:bg-[#b81f2f]" : ""} variant={status === "recording" ? "default" : "outline"}>
            {status === "recording" ? <><Square className="mr-2 size-4" />Detener</> : busy ? <><Loader2 className="mr-2 size-4 animate-spin" />{status === "transcribing" ? "Transcribiendo…" : "Preparando…"}</> : <><Mic className="mr-2 size-4" />Dictar</>}
          </Button>
          <Button type="button" variant="outline" onClick={organize} disabled={organizing || busy || status === "recording" || transcript.trim().length < 3} data-testid="anamnesis-organize">
            {organizing ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Sparkles className="mr-2 size-4" />}Ordenar en el formulario
          </Button>
        </div>
        <Textarea value={transcript} onChange={e => setTranscript(e.target.value)} rows={3} placeholder="Aquí aparece lo dictado; también puedes escribirlo." aria-label="Texto dictado de la anamnesis" />
      </div>

      {alerts.length > 0 && <div role="status" className="rounded-xl border border-[#d62839] bg-[#fff0f1] p-3 text-sm text-[#8f1a27]"><p className="font-semibold">Ten presente</p><ul className="list-disc pl-5">{alerts.map(a => <li key={a}>{a}</li>)}</ul></div>}

      <div className="grid gap-4 sm:grid-cols-2">
        <L label="Alergias (fármacos, látex, anestesia, alimentos)"><Textarea rows={2} value={form.allergies} onChange={e => set("allergies", e.target.value)} placeholder="Ej. Penicilina; niega otras" /></L>
        <L label="Medicamentos de uso habitual"><Textarea rows={2} value={form.medications} onChange={e => set("medications", e.target.value)} placeholder="Ej. Losartán 50 mg c/12 h" /></L>
      </div>
      <Yn label="¿Usa anticoagulantes / antiagregantes?" value={form.anticoagulants} onChange={v => set("anticoagulants", v)} />

      <fieldset className="space-y-2"><legend className="text-sm font-medium text-[#3d2f73]">Enfermedades y patologías</legend>
        <div className="grid gap-2 sm:grid-cols-2">{CONDITIONS.map(([id, label]) => <label key={id} className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${form.conditions.includes(id) ? "border-[#d62839] bg-[#fff0f1] font-medium" : "border-[#ddd6f0] bg-white"}`}>
          <input type="checkbox" checked={form.conditions.includes(id)} onChange={() => toggle(id)} className="size-4 accent-[#d62839]" />{label}</label>)}</div>
      </fieldset>
      <L label="Otras enfermedades"><Textarea rows={2} value={form.otherConditions} onChange={e => set("otherConditions", e.target.value)} /></L>

      <div className="grid gap-4 sm:grid-cols-2">
        <L label="Cirugías previas"><Textarea rows={2} value={form.surgeries} onChange={e => set("surgeries", e.target.value)} placeholder="Ej. Apendicectomía 2015" /></L>
        <L label="Hospitalizaciones"><Textarea rows={2} value={form.hospitalizations} onChange={e => set("hospitalizations", e.target.value)} /></L>
      </div>
      <L label="Reacciones previas a anestesia"><Input value={form.anesthesiaReactions} onChange={e => set("anesthesiaReactions", e.target.value)} maxLength={300} /></L>

      <div className="grid gap-4 sm:grid-cols-3">
        <L label="Embarazo / lactancia"><select value={form.pregnancy} onChange={e => set("pregnancy", e.target.value as Anamnesis["pregnancy"])} className="h-9 w-full rounded-md border border-[#ddd6f0] bg-white px-2 text-sm">
          <option value="">Sin registrar</option><option value="no">No</option><option value="embarazada">Embarazada</option><option value="lactancia">En lactancia</option><option value="no-aplica">No aplica</option></select></L>
        <L label="Tabaco"><Input value={form.smoking} onChange={e => set("smoking", e.target.value)} placeholder="Ej. 5 cigarrillos/día" maxLength={300} /></L>
        <L label="Alcohol"><Input value={form.alcohol} onChange={e => set("alcohol", e.target.value)} placeholder="Ej. social" maxLength={300} /></L>
      </div>

      <div className="grid gap-2 sm:grid-cols-2"><Yn label="Bruxismo / aprieta los dientes" value={form.bruxism} onChange={v => set("bruxism", v)} /><Yn label="Sangrado de encías" value={form.gumBleeding} onChange={v => set("gumBleeding", v)} /></div>
      <div className="grid gap-4 sm:grid-cols-2">
        <L label="Última visita al dentista"><Input value={form.lastDentalVisit} onChange={e => set("lastDentalVisit", e.target.value)} placeholder="Ej. hace 1 año" maxLength={300} /></L>
        <L label="Antecedentes odontológicos"><Textarea rows={2} value={form.dentalHistory} onChange={e => set("dentalHistory", e.target.value)} placeholder="Trauma, ortodoncia, cirugías orales, sensibilidad…" /></L>
      </div>
      <L label="Observaciones"><Textarea rows={2} value={form.observations} onChange={e => set("observations", e.target.value)} /></L>

      {error && <p role="alert" className="rounded-lg border border-[#e4a0a7] bg-[#fff5f5] p-2 text-sm text-[#922f3a]">{error}</p>}
      {notice && <p role="status" className="rounded-lg border border-[#b7dfc4] bg-[#f1fbf4] p-2 text-sm text-[#1d6b3a]">{notice}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={() => { engine.current.abort(); onClose(); }}>Cerrar</Button>
        <Button type="button" onClick={save} disabled={saving || status === "recording"} data-testid="anamnesis-save" className="bg-[#d62839] text-white hover:bg-[#b81f2f]">{saving ? "Guardando…" : "Guardar anamnesis"}</Button></div>
    </DialogContent>
  </Dialog>;
}
