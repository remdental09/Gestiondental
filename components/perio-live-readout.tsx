"use client";
import { Pause, Play, Square, Volume2, VolumeX } from "lucide-react";
import { formatFdi, type PerioSiteKey, type PerioTooth } from "@/app/clinical-data";
import { depthTone } from "@/app/perio-arch-layout";
import type { GuideRecord } from "@/lib/dictation/perio-guide";

/** Estado del dictado guiado que se muestra en grande junto a la pieza. */
export type GuideLive = {
  tooth: number; face: "vestibular" | "lingual"; step: "await" | "site" | "flags"; done: boolean;
  /** Sitio que se está preguntando (MV…DL) y parámetro. */ site?: PerioSiteKey; field?: "depth" | "margin";
  index: number; total: number; records: GuideRecord[]; recordId: number; alert?: string;
  listening: boolean; paused: boolean; noisy: boolean; muted: boolean; transcribing: boolean;
  controls: { authorize(): void; command(word: string): void; toggleMute(): void; stop(): void };
};

const SPOT: Record<string, string> = { M: "Mesial", V: "Central", L: "Central", D: "Distal" };
const FIELD: Record<GuideRecord["field"], string> = { depth: "Sondaje", margin: "Margen gingival", bleeding: "Sangrado", suppuration: "Supuración" };
const TONE = { none: "text-[#2a2540]", ok: "text-emerald-700", warn: "text-amber-600", crit: "text-rose-700" } as const;
const minus = (value: number) => (value < 0 ? `−${-value}` : String(value));
/** «MV», «V»…: el lado interno se nombra P (palatino) en el maxilar y L (lingual) en la mandíbula. */
export const siteCode = (tooth: number, key: PerioSiteKey) => (tooth < 30 ? key.replace("L", "P") : key);
const faceName = (tooth: number, face: "vestibular" | "lingual") => (face === "vestibular" ? "Vestibular" : tooth < 30 ? "Palatino" : "Lingual");
const spotOf = (key: PerioSiteKey) => (key.length === 2 ? SPOT[key[0]] : "Central");

/** Encabezado grande: «2.6 · Palatino · Mesial — Sondaje». */
export function liveHeading(live: Pick<GuideLive, "tooth" | "face" | "step" | "site" | "field">): string {
  if (live.step === "await") return `Pieza ${formatFdi(live.tooth)}`;
  if (live.step === "flags") return `${formatFdi(live.tooth)} — Sangrado / supuración`;
  return `${formatFdi(live.tooth)} · ${faceName(live.tooth, live.face)} · ${live.site ? spotOf(live.site) : ""} — ${live.field === "margin" ? "Margen gingival" : "Sondaje"}`;
}
/** «Sondaje MV: 3 mm», «Margen gingival MP: −1», «Sangrado DV». */
export function recordLabel(record: GuideRecord): { label: string; value: string } {
  const code = siteCode(record.tooth, record.site);
  if (record.field === "depth") return { label: `${FIELD.depth} ${code}`, value: `${record.value} mm` };
  if (record.field === "margin") return { label: `${FIELD.margin} ${code}`, value: `${minus(record.value as number)} mm` };
  return { label: `${FIELD[record.field]} ${code}`, value: "Sí" };
}

const CSS = `
@keyframes perio-pop{0%{opacity:0;transform:scale(.55)}35%{opacity:1;transform:scale(1.14);box-shadow:0 0 0 6px rgba(239,137,95,.55),0 0 42px 12px rgba(239,137,95,.55)}
 70%{transform:scale(.98)}100%{transform:none;box-shadow:0 0 0 0 rgba(239,137,95,0)}}
@keyframes perio-cell{0%{background:#ffe2cf;transform:scale(1.25)}100%{background:transparent;transform:none}}
@keyframes perio-shake{0%,100%{transform:none}20%,60%{transform:translateX(-6px)}40%,80%{transform:translateX(6px)}}
.perio-pop{animation:perio-pop .9s cubic-bezier(.16,1,.3,1) both}
.perio-cell{animation:perio-cell 1.2s ease-out both}
.perio-shake{animation:perio-shake .45s ease-in-out both}
@media (prefers-reduced-motion:reduce){.perio-pop,.perio-cell,.perio-shake{animation:none}}`;

const ROWS: Array<[string, PerioSiteKey[]]> = [["vestibular", ["MV", "V", "DV"]], ["lingual", ["ML", "L", "DL"]]];

/** Panel grande (legible a ~1 m) con lo que se pregunta y lo que se anotó, junto a la pieza ampliada. */
export function PerioLiveReadout({ live, data }: { live: GuideLive; data: PerioTooth | undefined }) {
  const last = live.records[0];
  const { controls } = live;
  const status = live.transcribing ? "Revisando el audio…" : live.paused ? "En pausa" : live.listening ? "Escuchando" : "Hablando…";
  // Sin colores en conflicto: en Tailwind v4 gana el orden del CSS compilado, no el del atributo (antes «Terminar» salía blanco sobre blanco).
  const btnBase = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border px-3 text-base font-semibold";
  const btn = `${btnBase} border-[#dddbe6] bg-white text-[#2a2540] hover:bg-[#efeef4]`;
  const btnStop = `${btnBase} border-rose-700 bg-rose-700 text-white hover:bg-rose-800`;
  return <section aria-label="Dictado periodontal en vivo" data-testid="perio-live-readout" className="space-y-3 rounded-2xl border-2 border-[#473a6d] bg-[#fbfaff] p-3 sm:p-4">
    <style>{CSS}</style>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className={`rounded-full px-3 py-1 text-sm font-semibold ${live.paused || live.noisy ? "bg-amber-100 text-amber-900" : live.listening ? "bg-emerald-100 text-emerald-900" : "bg-slate-100 text-slate-700"}`}>{status} · pieza {live.index + 1} de {live.total}</span>
      <button type="button" onClick={controls.toggleMute} aria-pressed={live.muted} data-testid="perio-mute" className={btn}>{live.muted ? <><VolumeX className="size-5" />Voz apagada</> : <><Volume2 className="size-5" />Voz encendida</>}</button>
    </div>
    <p aria-live="polite" className="text-4xl font-bold leading-tight tracking-tight text-[#2a2540] sm:text-5xl" data-testid="perio-live-heading">{liveHeading(live)}</p>
    {live.step === "await" && <button type="button" autoFocus onClick={controls.authorize} className="w-full rounded-xl bg-[#ef895f] px-4 py-4 text-2xl font-bold text-[#2a2540] hover:bg-[#e67a4d]">Autorizar pieza {formatFdi(live.tooth)} <span className="block text-base font-medium">o di «sigue» · «pieza …» para otra</span></button>}
    {live.alert && <p key={`a${live.recordId}`} role="alert" className="perio-shake rounded-xl border-2 border-amber-400 bg-amber-50 px-4 py-3 text-4xl font-bold text-amber-900 sm:text-5xl" data-testid="perio-live-alert">{live.alert}</p>}
    {last && !live.alert && <div key={live.recordId} className="perio-pop rounded-xl border border-[#ef895f] bg-white px-4 py-3" data-testid="perio-live-last">
      <p className="text-2xl font-semibold text-[#615f73] sm:text-3xl">{recordLabel(last).label}</p>
      <p className={`text-6xl font-black leading-none sm:text-7xl ${last.field === "depth" ? TONE[depthTone(last.value as number)] : "text-[#2a2540]"}`}>{recordLabel(last).value}</p>
      {live.records.length > 1 && <p className="mt-1 text-xl font-semibold text-[#3b3355]">{live.records.slice(1).map(r => `${recordLabel(r).label}: ${recordLabel(r).value}`).join(" · ")}</p>}
    </div>}
    <table className="w-full table-fixed border-separate border-spacing-1 text-center" aria-label={`Medidas de la pieza ${formatFdi(live.tooth)}`}>
      <tbody>{ROWS.map(([face, keys]) => <tr key={face}>
        {keys.map(key => {
          const reading = data?.sites[key], depth = reading?.depth ?? null, margin = reading?.margin ?? null;
          const asking = live.step === "site" && live.site === key;
          const fresh = live.records.some(r => r.site === key);
          return <td key={`${key}-${fresh ? live.recordId : 0}`} className={`rounded-lg border px-1 py-1.5 ${asking ? "border-[#473a6d] ring-2 ring-[#473a6d]" : "border-[#e6e4ee]"} ${fresh ? "perio-cell" : ""}`}>
            <span className="block text-sm font-bold text-[#615f73]">{siteCode(live.tooth, key)}</span>
            <span className={`block text-3xl font-black leading-tight ${TONE[depthTone(depth)]}`} title="Sondaje">{depth ?? "–"}</span>
            <span className="block text-base font-semibold text-[#3b3355]" title="Margen gingival">MG {margin === null ? "–" : minus(margin)}</span>
            <span className="block text-sm font-semibold">{reading?.bleeding && <span className="text-rose-700">sangra </span>}{reading?.suppuration && <span className="text-amber-700">supura</span>}</span>
          </td>;
        })}
      </tr>)}</tbody>
    </table>
    <div className="flex flex-wrap gap-1.5">
      <button type="button" className={btn} onClick={() => controls.command("corrige")}>Corrige</button>
      <button type="button" className={btn} onClick={() => controls.command("repite")}>Repite</button>
      <button type="button" className={btn} onClick={() => controls.command("atrás")}>Atrás</button>
      <button type="button" className={btn} onClick={() => controls.command("salta")}>Salta pieza</button>
      <button type="button" className={btn} onClick={() => controls.command(live.paused ? "sigue" : "pausa")}>{live.paused ? <><Play className="size-4" />Sigue</> : <><Pause className="size-4" />Pausa</>}</button>
      <button type="button" className={btnStop} onClick={controls.stop}><Square className="size-4" />Terminar</button>
    </div>
    <p className="text-sm leading-5 text-[#615f73]">Di un número por vez (0 a 12; el margen puede ser «menos 1»). Órdenes: «corrige», «repite», «atrás», «salta», «pausa», «sigue», «sangra», «supura», «pieza …». Sondaje ≥ 4 mm en ámbar y ≥ 6 mm en rojo.</p>
  </section>;
}
