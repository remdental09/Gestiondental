"use client";

import { useMemo, useState } from "react";
import { FileUp, CheckCircle2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { chileToFdi, universalToFdi } from "@/lib/dictation/proposal";
import { buildImport, chunkBundles, commonZoneNumber, detectKind, needsNumbering, parseCsv, toRecords, type CsvKind, type Numbering, type Row } from "@/lib/platform-import";
import { readZip } from "@/lib/zip-reader";

const KIND_LABEL: Record<CsvKind, string> = { pacientes: "Pacientes", planes: "Planes de tratamiento", tratamientos: "Tratamientos de los planes", evoluciones: "Evoluciones", pagos: "Pagos", aranceles: "Aranceles" };
const COUNT_LABEL = { pacientes: "fichas de pacientes", planes: "planes de tratamiento", tratamientos: "tratamientos", evoluciones: "evoluciones", pagos: "pagos", aranceles: "aranceles propios" } as const;
const MAX_FILE_BYTES = 40_000_000;
type Counts = Record<string, number>;
type Verified = { pacientes: number; planes: number; evoluciones: number; pagos: number };

function decode(data: Uint8Array): string {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(data); } catch { return new TextDecoder("windows-1252").decode(data); }
}
const fdiText = (fdi: number | null) => (fdi ? `${Math.floor(fdi / 10)}.${fdi % 10}` : "—");
const post = async (body: unknown) => {
  const response = await fetch("/api/importar-plataforma", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({})) as { result?: Counts; error?: string };
  if (!response.ok || !data.result) throw new Error(data.error || "No se pudo importar este grupo.");
  return data.result;
};

/** Configuración: importar pacientes, planes, evoluciones, pagos y aranceles desde la exportación en CSV de otra plataforma. */
export function ConfiguracionPanel() {
  const [tables, setTables] = useState<Partial<Record<CsvKind, Row[]>>>({});
  const [ignored, setIgnored] = useState<string[]>([]);
  const [readError, setReadError] = useState("");
  const [numbering, setNumbering] = useState<Numbering | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [report, setReport] = useState<{ totals: Counts; failedGroups: number; verified: Verified | null; verifyError: boolean } | null>(null);

  const loaded = Object.keys(tables).length > 0;
  const askNumbering = needsNumbering(tables);
  // Las piezas 1–16 se leen igual en ambas numeraciones; el ejemplo usa una inferior (17–32) para que la diferencia se vea.
  const zoneNumber = useMemo(() => commonZoneNumber(tables.tratamientos ?? [], 17) ?? commonZoneNumber(tables.tratamientos ?? []), [tables]);
  const result = useMemo(() => (loaded && (!askNumbering || numbering) ? buildImport(tables, numbering) : null), [tables, numbering, loaded, askNumbering]);
  const busy = progress !== null;

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setReadError(""); setReport(null); setConfirming(false); setNumbering(null);
    try {
      const sources: Array<{ name: string; data: Uint8Array }> = [];
      for (const file of Array.from(files)) {
        if (file.size > MAX_FILE_BYTES) throw new Error(`«${file.name}» es demasiado grande.`);
        const bytes = new Uint8Array(await file.arrayBuffer());
        if (/\.zip$/i.test(file.name)) sources.push(...(await readZip(bytes.buffer as ArrayBuffer)).filter(entry => /\.csv$/i.test(entry.name)));
        else if (/\.csv$/i.test(file.name)) sources.push({ name: file.name, data: bytes });
        else throw new Error(`«${file.name}» no es un .zip ni un .csv.`);
      }
      const next: Partial<Record<CsvKind, Row[]>> = {}, skipped: string[] = [];
      for (const source of sources) {
        const rows = parseCsv(decode(source.data));
        const kind = rows[0] ? detectKind(rows[0]) : null;
        if (!kind) { skipped.push(source.name.split("/").pop() ?? source.name); continue; }
        next[kind] = [...(next[kind] ?? []), ...toRecords(rows)];
      }
      setTables(next); setIgnored(skipped);
      if (!Object.keys(next).length) setReadError("No reconocí ningún archivo. Sube la exportación completa (.zip) de la otra plataforma.");
    } catch (error) {
      setTables({}); setIgnored([]);
      setReadError(error instanceof Error ? error.message : "No se pudo leer el archivo.");
    }
  }

  async function runImport() {
    if (!result) return;
    setConfirming(false); setReport(null);
    const groups = chunkBundles(result.bundles);
    const totals: Counts = {};
    let failedGroups = 0, done = 0;
    const total = groups.length + (result.tariffs.length ? 1 : 0);
    setProgress({ done, total });
    const add = (counts: Counts) => { for (const [key, value] of Object.entries(counts)) totals[key] = (totals[key] ?? 0) + value; };
    for (const group of groups) {
      try { add(await post({ action: "fichas", bundles: group })); } catch { failedGroups += 1; }
      setProgress({ done: ++done, total });
    }
    if (result.tariffs.length) {
      try { const r = await post({ action: "aranceles", tariffs: result.tariffs }); totals.tariffsCreated = r.created; totals.tariffsSkipped = r.skipped; } catch { failedGroups += 1; }
      setProgress({ done: ++done, total });
    }
    let verified: Verified | null = null, verifyError = false;
    try {
      const response = await fetch("/api/importar-plataforma", { cache: "no-store" });
      const data = await response.json().catch(() => ({})) as { totals?: Verified };
      if (response.ok && data.totals) verified = data.totals; else verifyError = true;
    } catch { verifyError = true; }
    setProgress(null);
    setReport({ totals, failedGroups, verified, verifyError });
  }

  return (
    <div className="space-y-5" data-testid="configuracion-panel">
      <div>
        <h2 className="text-xl font-semibold text-[#2b2540]">Configuración</h2>
        <p className="text-sm text-[#6b6a7c]">Ajustes de tu cuenta y de la plataforma.</p>
      </div>

      <section className="space-y-4 rounded-xl border border-[#e2dfea] bg-white p-5" aria-labelledby="importar-titulo">
        <div>
          <h3 id="importar-titulo" className="text-base font-semibold text-[#2b2540]">Importar desde otra plataforma</h3>
          <p className="mt-1 text-sm text-[#6b6a7c]">Sube la exportación completa (.zip) o los archivos .csv: pacientes, planes de tratamiento, evoluciones, pagos y aranceles. Se leen aquí en tu navegador y nada se guarda hasta que confirmes. Puedes repetirlo sin duplicar fichas.</p>
        </div>

        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-[#bdb4cf] bg-[#faf9fc] p-4 text-sm font-medium text-[#473a6d] hover:bg-[#f2f0f7]">
          <FileUp className="size-5" aria-hidden />
          <span>Elegir archivo .zip o .csv</span>
          <input type="file" multiple accept=".zip,.csv,application/zip,text/csv" className="sr-only" disabled={busy} data-testid="importar-archivos" onChange={event => { void onFiles(event.target.files); event.target.value = ""; }} />
        </label>
        {readError && <p role="alert" className="text-sm text-[#a23b4a]">{readError}</p>}

        {loaded && (
          <div className="space-y-4">
            <div>
              <p className="text-sm font-semibold text-[#2b2540]">Archivos reconocidos</p>
              <ul className="mt-1 text-sm text-[#4f4e62]">
                {(Object.keys(tables) as CsvKind[]).map(kind => <li key={kind}>{KIND_LABEL[kind]}: {tables[kind]!.length.toLocaleString("es-CL")} filas</li>)}
              </ul>
              {ignored.length > 0 && <p className="mt-1 text-xs text-[#6b6a7c]">No reconocidos (se omiten): {ignored.join(", ")}</p>}
            </div>

            {askNumbering && (
              <fieldset className="space-y-2 rounded-lg bg-[#f6f5fa] p-3" data-testid="importar-numeracion">
                <legend className="px-1 text-sm font-semibold text-[#2b2540]">¿Con qué numeración dental vienen las piezas?</legend>
                <p className="text-xs text-[#6b6a7c]">Los archivos traen piezas como 1 a 32. Elige la que usaba la otra plataforma; yo las paso a FDI. Las piezas 1 a 16 se leen igual en ambas; cambian las inferiores.{zoneNumber ? ` Ejemplo con la pieza ${zoneNumber}, una de las más usadas en tus archivos.` : ""}</p>
                {([["universal", "Universal (1 a 32, desde el tercer molar superior derecho)", universalToFdi], ["chile", "Chilena (1 a 32, por cuadrantes)", chileToFdi]] as const).map(([value, label, convert]) => (
                  <label key={value} className="flex items-start gap-2 text-sm text-[#2b2540]">
                    <input type="radio" name="numeracion" className="mt-1" checked={numbering === value} disabled={busy} onChange={() => setNumbering(value)} />
                    <span>{label}{zoneNumber ? <span className="text-[#6b6a7c]"> · la {zoneNumber} sería la pieza {fdiText(convert(zoneNumber))}</span> : null}</span>
                  </label>
                ))}
              </fieldset>
            )}

            {result && (
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-semibold text-[#2b2540]">Se importará</p>
                  <ul className="mt-1 text-sm text-[#4f4e62]">
                    {(Object.keys(COUNT_LABEL) as Array<keyof typeof COUNT_LABEL>).filter(key => result.totals[key]).map(key => <li key={key}>{result.totals[key].toLocaleString("es-CL")} {COUNT_LABEL[key]}</li>)}
                  </ul>
                </div>
                {result.warnings.length > 0 && (
                  <div className="rounded-lg bg-[#fff7e8] p-3 text-sm text-[#6b4e12]" data-testid="importar-avisos">
                    <p className="flex items-center gap-1 font-semibold"><AlertTriangle className="size-4" aria-hidden />A tener en cuenta</p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5">{result.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>
                  </div>
                )}
                <p className="text-xs text-[#6b6a7c]">Las evoluciones se guardan tal cual venían, con una línea que indica que fueron importadas; no se interpretan ni se convierten en diagnósticos. Los pagos y los valores de los planes se importan como figuran en el archivo y conviene que los verifiques.</p>

                {!confirming && !busy && <Button type="button" className="bg-[#473a6d] hover:bg-[#3a2f5a]" onClick={() => setConfirming(true)} data-testid="importar-iniciar">Importar</Button>}
                {confirming && (
                  <div className="space-y-2 rounded-lg border border-[#e2dfea] p-3" role="alertdialog" aria-label="Confirmar importación">
                    <p className="text-sm text-[#2b2540]">Se crearán las fichas, planes, evoluciones y pagos de arriba en tu cuenta. Si una ficha ya existe (mismo documento) se completa sin duplicar.</p>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" className="bg-[#473a6d] hover:bg-[#3a2f5a]" onClick={() => void runImport()} data-testid="importar-confirmar">Confirmar e importar</Button>
                      <Button type="button" size="sm" variant="outline" onClick={() => setConfirming(false)}>Cancelar</Button>
                    </div>
                  </div>
                )}
                {busy && progress && (
                  <div role="status" aria-live="polite" className="space-y-1">
                    <div className="h-2 overflow-hidden rounded bg-[#e6e4ee]"><div className="h-full bg-[#5c4886] transition-all" style={{ width: `${Math.round(progress.done / Math.max(1, progress.total) * 100)}%` }} /></div>
                    <p className="text-xs text-[#6b6a7c]">Importando… {progress.done} de {progress.total} grupos. No cierres esta página.</p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {report && (
          <div className="space-y-1 rounded-lg bg-[#eef7f1] p-3 text-sm text-[#1f5133]" role="status" data-testid="importar-resultado">
            <p className="flex items-center gap-1 font-semibold"><CheckCircle2 className="size-4" aria-hidden />Importación terminada</p>
            <ul className="list-disc pl-5">
              <li>Fichas nuevas: {report.totals.patientsCreated ?? 0} · ya existían: {report.totals.patientsExisting ?? 0}</li>
              <li>Planes: {report.totals.plansCreated ?? 0} nuevos · {report.totals.plansSkipped ?? 0} ya estaban</li>
              <li>Evoluciones: {report.totals.notesCreated ?? 0} nuevas · {report.totals.notesSkipped ?? 0} ya estaban</li>
              <li>Pagos: {report.totals.paymentsCreated ?? 0} nuevos · {report.totals.paymentsSkipped ?? 0} ya estaban</li>
              {report.totals.tariffsCreated !== undefined && <li>Aranceles propios: {report.totals.tariffsCreated} nuevos · {report.totals.tariffsSkipped ?? 0} omitidos (repetidos o sin cupo)</li>}
            </ul>
            {report.verified && <p className="pt-1">Comprobado en tu cuenta: {report.verified.pacientes} fichas importadas, {report.verified.planes} planes, {report.verified.evoluciones} evoluciones y {report.verified.pagos} pagos.</p>}
            {report.verifyError && <p className="pt-1 text-[#6b4e12]">No pude comprobar lo guardado; revisa las fichas antes de dar la importación por buena.</p>}
            {(report.failedGroups > 0 || (report.totals.failed ?? 0) > 0) && <p className="pt-1 text-[#8a2f3c]">{report.failedGroups + (report.totals.failed ?? 0)} grupos o fichas no se pudieron importar. Vuelve a subir los archivos: lo que ya está guardado no se duplica.</p>}
          </div>
        )}
      </section>
    </div>
  );
}
