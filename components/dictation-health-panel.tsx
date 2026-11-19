"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

type Stage = "diagnosis" | "plan" | "proposal" | "save" | "flow";
type Platform = "ios_safari" | "ios_other" | "android_chrome" | "android_other" | "desktop_chrome" | "desktop_safari" | "desktop_firefox" | "desktop_edge" | "desktop_other" | "unknown";
type StageSummary = {
  stage: Stage;
  events: number;
  failures: number;
  completed: number;
  byEvent: Array<{ event: string; count: number }>;
  byErrorCode: Array<{ errorCode: string; count: number }>;
  durationBuckets: Array<{ bucket: string; count: number }>;
  byPlatform: Array<{ platform: Platform; events: number; failures: number }>;
};
type HealthSummary = {
  days: Array<{ day: string; events: number; failures: number; completed: number; stages: StageSummary[] }>;
  totals: { events: number; failures: number; completed: number; stages: StageSummary[]; durationBuckets: Array<{ bucket: string; count: number }> };
};

const STAGE_LABEL: Record<Stage, string> = {
  diagnosis: "Diagnóstico",
  plan: "Plan",
  proposal: "Revisión IA",
  save: "Guardado",
  flow: "Flujo completo",
};
const PLATFORM_LABEL: Record<Platform, string> = {
  ios_safari: "iPhone/iPad · Safari",
  ios_other: "iPhone/iPad · otro navegador",
  android_chrome: "Android · Chrome",
  android_other: "Android · otro navegador",
  desktop_chrome: "Escritorio · Chrome",
  desktop_safari: "Escritorio · Safari",
  desktop_firefox: "Escritorio · Firefox",
  desktop_edge: "Escritorio · Edge",
  desktop_other: "Escritorio · otro navegador",
  unknown: "Navegador no identificado",
};
const DURATION_LABEL: Record<string, string> = { lt_1s: "<1 s", "1_3s": "1–3 s", "3_10s": "3–10 s", "10_30s": "10–30 s", "30_60s": "30–60 s", gte_60s: "≥60 s" };
const chileDay = (date: Date) => {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Santiago", year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date).reduce<Record<string, string>>((result, part) => { result[part.type] = part.value; return result; }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
};
const eventCount = (stages: StageSummary[], event: string) => stages.flatMap(stage => stage.byEvent).filter(row => row.event === event).reduce((sum, row) => sum + row.count, 0);
const errorCounts = (stages: StageSummary[]) => {
  const totals = new Map<string, number>();
  for (const stage of stages) for (const row of stage.byErrorCode) totals.set(row.errorCode, (totals.get(row.errorCode) ?? 0) + row.count);
  return [...totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4);
};

/** Aggregate technical health for the app owner. This view never receives clinical text or patient identifiers. */
export function DictationHealthPanel() {
  const [data, setData] = useState<HealthSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/dictation/telemetry", { cache: "no-store" });
      const body = await response.json().catch(() => ({})) as HealthSummary & { error?: string };
      if (!response.ok) throw new Error(body.error || "No se pudo leer la telemetría.");
      setData(body);
    } catch (cause) {
      setData(null);
      setError(cause instanceof Error ? cause.message : "No se pudo leer la telemetría.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const stages = data?.totals.stages ?? [];
  const flow = stages.find(stage => stage.stage === "flow");
  const starts = flow?.byEvent.find(event => event.event === "flow_started")?.count ?? 0;
  const completed = flow?.byEvent.find(event => event.event === "flow_completed")?.count ?? 0;
  const abandoned = flow?.byEvent.find(event => event.event === "flow_abandoned")?.count ?? 0;
  const unrecognized = eventCount(stages, "voice_unrecognized");
  const completionRate = starts ? Math.round(completed / starts * 100) : null;
  const platforms = stages.flatMap(stage => stage.byPlatform).reduce((map, row) => {
    const current = map.get(row.platform) ?? { events: 0, failures: 0 };
    current.events += row.events;
    current.failures += row.failures;
    map.set(row.platform, current);
    return map;
  }, new Map<Platform, { events: number; failures: number }>());
  const errors = errorCounts(stages);
  const slowDurations = data?.totals.durationBuckets.filter(row => row.bucket === "10_30s" || row.bucket === "30_60s" || row.bucket === "gte_60s").reduce((sum, row) => sum + row.count, 0) ?? 0;
  const chileToday = chileDay(new Date());
  const weekStart = new Date(`${chileToday}T00:00:00Z`);
  weekStart.setUTCDate(weekStart.getUTCDate() - 6);
  const recentCutoff = weekStart.toISOString().slice(0, 10);
  const recentDays = data?.days.filter(day => day.day >= recentCutoff && day.day <= chileToday) ?? [];
  const recentFailures = recentDays.reduce((sum, day) => sum + day.failures, 0);

  return <section className="mt-4 rounded-xl border border-[#dcd8e8] bg-[#faf9fc] p-4" aria-label="Vigilancia técnica del dictado por pieza" data-testid="dictation-health-panel">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h4 className="flex items-center gap-2 text-base font-semibold text-[#3b3355]"><Activity className="size-4"/>Vigilancia técnica del dictado por pieza</h4>
        <p className="mt-1 text-sm text-[#615f73]">Conteos agregados de todos los usuarios, de los últimos 30 días. No se guardan audio, transcripciones, cuentas individuales, piezas ni pacientes.</p>
      </div>
      <Button type="button" variant="outline" size="sm" disabled={loading} onClick={() => void refresh()}>
        <RefreshCw className={`mr-2 size-4 ${loading ? "animate-spin" : ""}`}/>Actualizar
      </Button>
    </div>

    {loading && <p role="status" className="mt-4 text-sm text-[#615f73]">Cargando métricas técnicas…</p>}
    {error && !loading && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-900">{error}</p>}
    {data && !loading && <>
      <div className="mt-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {[
          ["Flujos iniciados", String(starts)],
          ["Guardados correctamente", `${completed}${completionRate === null ? "" : ` · ${completionRate}%`} `],
          ["Cierres antes de guardar", String(abandoned)],
          ["Fallos técnicos", String(data.totals.failures)],
        ].map(([label, value]) => <div key={label} className="rounded-lg border border-[#ebeaf1] bg-white p-3">
          <p className="text-xs text-[#6b6a7c]">{label}</p><p className="mt-1 text-xl font-semibold text-[#3b3355]">{value}</p>
        </div>)}
      </div>

      {!data.totals.events && <p className="mt-3 rounded-lg bg-white p-3 text-sm text-[#615f73]">Aún no hay datos. El monitor empezará a contar cuando se use el dictado por pieza.</p>}

      {recentFailures > 0 && <p role="status" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-950">
        En los últimos siete días se registraron {recentFailures} errores técnicos. Revisa la etapa y la causa más abajo; algunos pueden haberse recuperado al reintentar.
      </p>}

      {data.totals.events > 0 && <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div>
          <h5 className="text-sm font-semibold text-[#3b3355]">Fallos por etapa</h5>
          <ul className="mt-2 space-y-1 text-sm">
            {stages.filter(stage => stage.failures > 0).sort((a, b) => b.failures - a.failures).map(stage => <li key={stage.stage} className="flex justify-between gap-3 rounded-md bg-white px-3 py-2">
              <span>{STAGE_LABEL[stage.stage]}</span><strong>{stage.failures} / {stage.events} eventos</strong>
            </li>)}
            {!stages.some(stage => stage.failures > 0) && <li className="rounded-md bg-emerald-50 px-3 py-2 text-emerald-900">Sin fallos técnicos registrados.</li>}
          </ul>
          {errors.length > 0 && <p className="mt-2 text-xs text-[#6b6a7c]">Causas más frecuentes: {errors.map(([code, count]) => `${code.replaceAll("_", " ")} (${count})`).join(" · ")}</p>}
          <p className="mt-2 text-xs text-[#6b6a7c]">Órdenes de voz no reconocidas: {unrecognized} · respuestas de servicios sobre 10 s: {slowDurations}.</p>
        </div>
        <div>
          <h5 className="text-sm font-semibold text-[#3b3355]">Navegadores observados</h5>
          <ul className="mt-2 space-y-1 text-sm">
            {[...platforms.entries()].sort((a, b) => b[1].failures - a[1].failures || b[1].events - a[1].events).map(([platform, value]) => <li key={platform} className="flex justify-between gap-3 rounded-md bg-white px-3 py-2">
              <span>{PLATFORM_LABEL[platform]}</span><span className={value.failures ? "font-medium text-rose-800" : "text-[#615f73]"}>{value.failures} fallos / {value.events} eventos</span>
            </li>)}
            {!platforms.size && <li className="rounded-md bg-white px-3 py-2 text-[#615f73]">Sin eventos por navegador.</li>}
          </ul>
        </div>
      </div>}

      {recentDays.length > 0 && <div className="mt-4">
        <h5 className="text-sm font-semibold text-[#3b3355]">Actividad reciente · hora de Chile</h5>
        <ul className="mt-2 space-y-1 text-sm">
          {recentDays.map(day => <li key={day.day} className="flex flex-wrap justify-between gap-2 rounded-md bg-white px-3 py-2">
            <time dateTime={day.day}>{new Intl.DateTimeFormat("es-CL", { day: "2-digit", month: "short", timeZone: "UTC" }).format(new Date(`${day.day}T12:00:00Z`))}</time>
            <span className="text-[#615f73]">{day.events} eventos · {day.completed} flujos guardados · {day.failures} fallos</span>
          </li>)}
        </ul>
      </div>}

      {data.totals.durationBuckets.length > 0 && <p className="mt-3 text-xs text-[#6b6a7c]">Tiempos de respuesta de transcripción, IA y guardado: {data.totals.durationBuckets.map(row => `${DURATION_LABEL[row.bucket] ?? row.bucket} (${row.count})`).join(" · ")}. No incluyen el tiempo que hablas.</p>}
    </>}
  </section>;
}
