"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HeartPulse, Loader2, Mic, Sparkles, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createAudioTranscription } from "@/lib/dictation/audio-transcription";
import { anamnesisAlerts, CONDITIONS, emptyAnamnesis, mergeAnamnesis, type Anamnesis, type ConditionId, type YesNo } from "@/lib/anamnesis";

const req = async (url: string, init?: RequestInit) => {
  const r = await fetch(url, { ...init, headers: { "Content-Type": "application/json" } });
  const data = await r.json().catch(() => ({})) as { anamnesis?: Anamnesis | null; error?: string };
  if (!r.ok) throw new Error(data.error || "No se pudo completar la acción.");
  return data.anamnesis ?? null;
};

/** Botón rojo destacado «Anamnesis» + resumen de alertas; abre el formulario dictable. */
export function AnamnesisButton({ patientId, patientName }: { patientId: number; patientName: string }) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<Anamnesis | null>(null);
  useEffect(() => { let live = true; setSaved(null); req(`/api/anamnesis?patientId=${patientId}`).then(a => { if (live) setSaved(a); }).catch(() => undefined); return () => { live = false; }; }, [patientId]);
  const alerts = saved ? anamnesisAlerts(saved) : [];
  return <>
    <Button type="button" onClick={() => setOpen(true)} data-testid="anamnesis-button" className="h-11 shrink-0 gap-2 rounded-xl bg-[#d62839] px-5 font-semibold text-white shadow-md hover:bg-[#b81f2f]">
      <HeartPulse className="size-5" />Anamnesis{alerts.length > 0 && <span className="rounded-full bg-white px-2 text-xs font-bold text-[#d62839]">{alerts.length}</span>}
    </Button>
    {open && <AnamnesisDialog patientId={patientId} patientName={patientName} initial={saved} onClose={() => setOpen(false)} onSaved={setSaved} />}
  </>;
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
