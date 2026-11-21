"use client";
/**
 * Configuración → «Importar pacientes (Dentalsoft u otro sistema)».
 * Lee Excel (.xlsx/.xls) o CSV en el navegador, reconoce las columnas, muestra la vista previa validada y
 * guarda solo al confirmar, en lotes. Las filas rechazadas se pueden descargar en CSV.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, Download, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  FIELD_GROUPS, KIND_LABEL, autoMap, buildApptRows, buildNoteRows, buildPatientRows, decodeText, detectSheetKind, findHeaderRow,
  foldHeader, parseDelimited, rejectedCsv, type Cell, type FieldKey, type PatientRow, type RejectedRow,
} from "@/lib/patient-import";
import { formatChileanRut } from "@/lib/patient-document";

type Sheet = { id: string; file: string; sheet: string; header: Cell[]; rows: Cell[][]; firstLine: number; mapping: Array<FieldKey | ""> };
type Outcome = { line: number; outcome: "creado" | "actualizado" | "omitido" | "error"; detail?: string };
type Tally = { creados: number; actualizados: number; omitidos: number; errores: number };
type Summary = { pacientes: Tally; evoluciones: Tally; citas: Tally; noImportado: string[]; rejected: RejectedRow[]; failedBatches: number };

const MAX_FILE_BYTES = 15_000_000;
const BATCH = 100;
const zero = (): Tally => ({ creados: 0, actualizados: 0, omitidos: 0, errores: 0 });
const STATUS: Record<PatientRow["status"], { label: string; className: string }> = {
  nuevo: { label: "Nueva", className: "bg-emerald-50 text-emerald-900" },
  existe: { label: "Ya existe", className: "bg-sky-50 text-sky-900" },
  duplicado: { label: "Duplicada", className: "bg-amber-50 text-amber-900" },
  error: { label: "Error", className: "bg-rose-50 text-rose-900" },
};
const select = "min-h-11 w-full rounded-lg border border-[#d2d4df] bg-white px-2 text-base text-[#35343f]";

async function readFile(file: File): Promise<Array<Omit<Sheet, "mapping" | "id">>> {
  if (file.size > MAX_FILE_BYTES) throw new Error(`${file.name}: el archivo pesa más de 15 MB.`);
  const buffer = await file.arrayBuffer();
  const name = file.name.toLowerCase();
  let tables: Array<{ sheet: string; rows: Cell[][] }>;
  if (/\.(csv|txt|tsv)$/.test(name)) {
    tables = [{ sheet: "CSV", rows: parseDelimited(decodeText(new Uint8Array(buffer)).text) }];
  } else {
    const XLSX = await import("xlsx");
    const book = XLSX.read(new Uint8Array(buffer), { type: "array", cellDates: false, dense: true });
    tables = book.SheetNames.map(sheet => ({ sheet, rows: XLSX.utils.sheet_to_json<Cell[]>(book.Sheets[sheet], { header: 1, raw: true, defval: "", blankrows: false }) }));
  }
  return tables.filter(t => t.rows.length >= 2).map(t => {
    const headerIndex = findHeaderRow(t.rows);
    const width = Math.max(...t.rows.slice(headerIndex, headerIndex + 50).map(r => r.length));
    const header = Array.from({ length: width }, (_, i) => t.rows[headerIndex][i] ?? "");
    const rows = t.rows.slice(headerIndex + 1).filter(r => r.some(c => String(c ?? "").trim()));
    return { file: file.name, sheet: t.sheet, header, rows, firstLine: headerIndex + 2 };
  }).filter(t => t.rows.length);
}

async function send(action: string, payload: Record<string, unknown>): Promise<Outcome[]> {
  const response = await fetch("/api/importar-pacientes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, ...payload }) });
  const data = await response.json().catch(() => ({})) as { results?: Outcome[]; error?: string };
  if (!response.ok || !data.results) throw new Error(data.error || "No se pudo importar este lote.");
  return data.results;
}

export function PatientImportPanel() {
  const [sheets, setSheets] = useState<Sheet[]>([]);
  const [existing, setExisting] = useState<Set<string> | null>(null);
  const [remembered, setRemembered] = useState<Record<string, FieldKey | "">>({});
  const [mode, setMode] = useState<"omitir" | "completar">("omitir");
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    let alive = true;
    void fetch("/api/importar-pacientes", { cache: "no-store" }).then(r => r.ok ? r.json() as Promise<{ ruts: string[]; mapping: Record<string, FieldKey | ""> }> : null)
      .then(data => { if (alive && data) { setExisting(new Set(data.ruts)); setRemembered(data.mapping ?? {}); } }).catch(() => undefined);
    return () => { alive = false; };
  }, []);

  const existingSet = useMemo(() => existing ?? new Set<string>(), [existing]);
  const analysis = useMemo(() => {
    const kinds = sheets.map(s => detectSheetKind(s.header, s.mapping));
    const patientRows = new Map<string, PatientRow[]>();
    const known = new Set(existingSet);
    sheets.forEach((s, i) => {
      if (kinds[i] !== "pacientes") return;
      const rows = buildPatientRows(s.rows, s.mapping, existingSet, s.firstLine);
      patientRows.set(s.id, rows);
      for (const row of rows) if (row.data.rut && row.status !== "error") known.add(row.data.rut);
    });
    const noteRows = new Map(sheets.map((s, i) => [s.id, kinds[i] === "evoluciones" ? buildNoteRows(s.rows, s.mapping, known, s.firstLine) : []]));
    const apptRows = new Map(sheets.map((s, i) => [s.id, kinds[i] === "citas" ? buildApptRows(s.rows, s.mapping, known, s.firstLine) : []]));
    return { kinds, patientRows, noteRows, apptRows };
  }, [sheets, existingSet]);

  async function onFiles(list: FileList | null) {
    if (!list?.length) return;
    setReading(true); setError(""); setSummary(null); setConfirming(false);
    const next: Sheet[] = [];
    try {
      for (const file of Array.from(list)) {
        for (const table of await readFile(file)) next.push({ ...table, id: `${file.name}#${table.sheet}#${next.length}`, mapping: autoMap(table.header, remembered) });
      }
      if (!next.length) throw new Error("No encontré filas con datos en el archivo.");
      setSheets(next);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "No pude leer el archivo."); }
    finally { setReading(false); }
  }

  const setColumn = (sheetId: string, column: number, field: FieldKey | "") => setSheets(current => current.map(s => {
    if (s.id !== sheetId) return s;
    const mapping = s.mapping.map((value, i) => i === column ? field : value === field && field ? "" : value);
    return { ...s, mapping };
  }));

  const cellsOf = (s: Sheet, line: number): Array<[string, Cell]> => s.header.map((h, i) => [String(h ?? `Columna ${i + 1}`), s.rows[line - s.firstLine]?.[i] ?? ""]);

  async function runImport() {
    setConfirming(false);
    const result: Summary = { pacientes: zero(), evoluciones: zero(), citas: zero(), noImportado: [], rejected: [], failedBatches: 0 };
    const reject = (s: Sheet, line: number, reason: string) => result.rejected.push({ file: s.file, sheet: s.sheet, line, reason, cells: cellsOf(s, line) });
    const tally = (t: Tally, s: Sheet, outcomes: Outcome[]) => { for (const o of outcomes) {
      if (o.outcome === "creado") t.creados++; else if (o.outcome === "actualizado") t.actualizados++; else if (o.outcome === "omitido") t.omitidos++;
      else { t.errores++; reject(s, o.line, o.detail || "Error al guardar"); }
    } };
    async function batches<T extends { line: number }>(label: string, s: Sheet, t: Tally, action: string, rows: T[], extra: Record<string, unknown> = {}) {
      for (let i = 0; i < rows.length; i += BATCH) {
        setProgress(`${label}: ${Math.min(i + BATCH, rows.length).toLocaleString("es-CL")} de ${rows.length.toLocaleString("es-CL")}…`);
        const chunk = rows.slice(i, i + BATCH);
        try { tally(t, s, await send(action, { rows: chunk, ...extra })); }
        catch (cause) { result.failedBatches++; for (const row of chunk) { t.errores++; reject(s, row.line, cause instanceof Error ? cause.message : "Lote no guardado"); } }
      }
    }
    try {
      for (const [i, s] of sheets.entries()) {
        if (analysis.kinds[i] !== "pacientes") continue;
        const rows = analysis.patientRows.get(s.id) ?? [];
        for (const row of rows) {
          if (row.status === "error") { result.pacientes.errores++; reject(s, row.line, row.errors.join("; ")); }
          else if (row.status === "duplicado") { result.pacientes.omitidos++; reject(s, row.line, `RUT repetido en el archivo (igual a la fila ${row.duplicateOf})`); }
          else if (row.status === "existe" && mode === "omitir") result.pacientes.omitidos++;
        }
        const toSend = rows.filter(r => r.status === "nuevo" || (r.status === "existe" && mode === "completar")).map(r => ({ line: r.line, data: r.data }));
        await batches("Pacientes", s, result.pacientes, "pacientes", toSend, { mode });
      }
      for (const [i, s] of sheets.entries()) {
        const kind = analysis.kinds[i];
        if (kind === "evoluciones" || kind === "citas") {
          const rows = (kind === "evoluciones" ? analysis.noteRows.get(s.id) : analysis.apptRows.get(s.id)) ?? [];
          const t = kind === "evoluciones" ? result.evoluciones : result.citas;
          // «No hay ficha con ese RUT» se vuelve a comprobar en el servidor (pudo crearse recién).
          const blocking = (errors: string[]) => errors.filter(e => e !== "No hay ficha con ese RUT");
          for (const row of rows) if (blocking(row.errors).length) { t.errores++; reject(s, row.line, blocking(row.errors).join("; ")); }
          await batches(kind === "evoluciones" ? "Evoluciones" : "Citas", s, t, kind, rows.filter(r => !blocking(r.errors).length));
        } else if (kind !== "pacientes") result.noImportado.push(`${s.file} · ${s.sheet} (${KIND_LABEL[kind]}, ${s.rows.length.toLocaleString("es-CL")} filas)`);
      }
      const mapping: Record<string, FieldKey | ""> = {};
      // Solo se recuerdan las correcciones hechas a mano (y las ya recordadas): «Fecha» significa cosas distintas según la hoja.
      for (const s of sheets) { const auto = autoMap(s.header); s.header.forEach((h, i) => { if (String(h ?? "").trim() && (s.mapping[i] !== auto[i] || foldHeader(h) in remembered)) mapping[String(h)] = s.mapping[i]; }); }
      await fetch("/api/importar-pacientes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "mapeo", mapping }) }).catch(() => undefined);
      setRemembered(current => ({ ...current, ...Object.fromEntries(Object.entries(mapping).map(([h, f]) => [foldHeader(h), f])) }));
      const fresh = await fetch("/api/importar-pacientes", { cache: "no-store" }).then(r => r.ok ? r.json() as Promise<{ ruts: string[] }> : null).catch(() => null);
      if (fresh) setExisting(new Set(fresh.ruts));
      window.dispatchEvent(new Event("gd-patients-imported"));
    } finally { setProgress(null); setSummary(result); }
  }

  const download = () => {
    if (!summary?.rejected.length) return;
    const url = URL.createObjectURL(new Blob([rejectedCsv(summary.rejected)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "filas-rechazadas.csv"; document.body.appendChild(a); a.click(); a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  const totals = useMemo(() => {
    const all = [...analysis.patientRows.values()].flat();
    const count = (status: PatientRow["status"]) => all.filter(r => r.status === status).length;
    const notes = [...analysis.noteRows.values()].flat(), appts = [...analysis.apptRows.values()].flat();
    return { nuevos: count("nuevo"), existen: count("existe"), duplicados: count("duplicado"), errores: count("error"), avisos: all.filter(r => r.warnings.length && r.status !== "error").length,
      notas: notes.filter(n => !n.errors.length).length, notasMal: notes.filter(n => n.errors.length).length, citas: appts.filter(a => !a.errors.length).length, citasMal: appts.filter(a => a.errors.length).length };
  }, [analysis]);
  const busy = reading || progress !== null;
  const anything = totals.nuevos + totals.existen + totals.notas + totals.citas > 0;

  return <section className="space-y-4 rounded-xl border border-[#e2dfea] bg-white p-4 sm:p-5" aria-labelledby="importar-pacientes-titulo" data-testid="importar-pacientes">
    <div>
      <h3 id="importar-pacientes-titulo" className="text-base font-semibold text-[#2b2540]">Importar pacientes (Dentalsoft u otro sistema)</h3>
      <p className="mt-1 text-sm text-[#6b6a7c]">Sube el Excel (.xlsx o .xls) o el CSV que te entrega Dentalsoft u otro sistema. Reconozco las columnas (RUT, nombres, apellidos, nacimiento, teléfono, correo, dirección, previsión…), puedes corregirlas, y nada se guarda hasta que confirmes.</p>
    </div>
    <label className="flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border border-dashed border-[#bdb4cf] bg-[#faf9fc] p-4 text-base font-medium text-[#473a6d] hover:bg-[#f2f0f7]">
      <FileSpreadsheet className="size-5 shrink-0" aria-hidden />
      <span>{reading ? "Leyendo archivo…" : "Elegir archivo Excel o CSV (puedes elegir varios)"}</span>
      <input type="file" multiple accept=".xlsx,.xls,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" className="sr-only" disabled={busy} data-testid="importar-pacientes-archivo" onChange={event => { void onFiles(event.target.files); event.target.value = ""; }} />
    </label>
    {error && <p role="alert" className="text-sm text-[#a23b4a]">{error}</p>}

    {sheets.map((s, index) => {
      const kind = analysis.kinds[index];
      const patientRows = analysis.patientRows.get(s.id) ?? [];
      const notes = analysis.noteRows.get(s.id) ?? [], appts = analysis.apptRows.get(s.id) ?? [];
      const sample = (column: number) => String(s.rows.find(r => String(r[column] ?? "").trim())?.[column] ?? "").slice(0, 40);
      return <div key={s.id} className="space-y-3 rounded-lg border border-[#e6e4ee] p-3" data-testid="importar-hoja">
        <p className="text-sm font-semibold text-[#2b2540]">{s.file}{s.sheet !== "CSV" ? ` · hoja «${s.sheet}»` : ""} — <span data-testid="importar-tipo">{KIND_LABEL[kind]}</span> · {s.rows.length.toLocaleString("es-CL")} filas</p>
        {(kind === "presupuestos" || kind === "pagos" || kind === "desconocido") && <p className="rounded-lg bg-[#fff7e8] p-2 text-sm text-[#6b4e12]">{kind === "desconocido" ? "No reconozco esta hoja. Si son pacientes, indica abajo qué columna es el nombre." : `${KIND_LABEL[kind]}: aún no se importan; quedarán como «no importado» en el resumen.`}</p>}
        <details open={index === 0} className="rounded-lg bg-[#f6f5fa] p-2">
          <summary className="min-h-11 cursor-pointer content-center text-sm font-semibold text-[#473a6d]">Columnas reconocidas ({s.mapping.filter(Boolean).length} de {s.header.length}) — tócalas para corregir</summary>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {s.header.map((h, column) => <li key={column} className="rounded-lg bg-white p-2">
              <label className="block text-sm text-[#35343f]"><span className="font-semibold">{String(h ?? "").trim() || `Columna ${column + 1}`}</span>{sample(column) && <span className="block truncate text-xs text-[#6b6a7c]">Ej.: {sample(column)}</span>}
                <select className={`${select} mt-1`} value={s.mapping[column]} onChange={event => setColumn(s.id, column, event.target.value as FieldKey | "")} data-testid="importar-columna">
                  <option value="">Ignorar</option>
                  {FIELD_GROUPS.map(group => <optgroup key={group.label} label={group.label}>{group.fields.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</optgroup>)}
                </select>
              </label>
            </li>)}
          </ul>
        </details>
        {kind === "pacientes" && <div className="overflow-x-auto rounded-lg border border-[#e6e4ee]">
          <table className="w-full min-w-[640px] text-left text-sm" data-testid="importar-vista-previa">
            <thead className="bg-[#f6f5fa] text-xs text-[#4f4e62]"><tr><th className="p-2">Fila</th><th className="p-2">Estado</th><th className="p-2">Nombre</th><th className="p-2">RUT</th><th className="p-2">Nacimiento</th><th className="p-2">Teléfono</th><th className="p-2">Correo</th><th className="p-2">Avisos</th></tr></thead>
            <tbody>{patientRows.slice(0, 8).map(row => <tr key={row.line} className="border-t border-[#efedf4] align-top">
              <td className="p-2 text-[#6b6a7c]">{row.line}</td>
              <td className="p-2"><span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${STATUS[row.status].className}`}>{STATUS[row.status].label}</span></td>
              <td className="p-2">{row.data.name || "—"}</td><td className="p-2 whitespace-nowrap">{row.data.rut ? formatChileanRut(row.data.rut) : "—"}</td>
              <td className="p-2 whitespace-nowrap">{row.data.birthDate ? row.data.birthDate.split("-").reverse().join("-") : "—"}</td><td className="p-2 whitespace-nowrap">{row.data.phone || "—"}</td><td className="p-2">{row.data.email || "—"}</td>
              <td className="p-2 text-xs text-[#8a2f3c]">{[...row.errors, ...row.warnings, row.duplicateOf ? `Igual a la fila ${row.duplicateOf}` : ""].filter(Boolean).join(" · ")}</td>
            </tr>)}</tbody>
          </table>
        </div>}
        {(kind === "evoluciones" || kind === "citas") && <ul className="space-y-1 text-sm text-[#4f4e62]">
          {(kind === "evoluciones" ? notes : appts).slice(0, 5).map(row => <li key={row.line} className="rounded bg-[#faf9fc] p-2"><span className="text-[#6b6a7c]">Fila {row.line}:</span> {row.rut ? formatChileanRut(row.rut) : "sin RUT"} · {"date" in row ? `${row.date.split("-").reverse().join("-")} · ${row.text.slice(0, 80)}` : `${row.day.split("-").reverse().join("-")} ${row.time} · ${row.reason}`}{row.errors.length > 0 && <span className="block text-xs text-[#8a2f3c]">{row.errors.join(" · ")}</span>}</li>)}
        </ul>}
      </div>;
    })}

    {sheets.length > 0 && !summary && <div className="space-y-3 rounded-lg bg-[#f6f5fa] p-3" data-testid="importar-resumen-previo">
      <p className="text-sm font-semibold text-[#2b2540]">Antes de importar</p>
      <ul className="grid gap-1 text-sm text-[#35343f] sm:grid-cols-2">
        <li>Pacientes nuevos: <strong data-testid="importar-n-nuevos">{totals.nuevos}</strong></li>
        <li>Ya existen (mismo RUT): <strong>{totals.existen}</strong></li>
        <li>Duplicados en el archivo: <strong>{totals.duplicados}</strong></li>
        <li>Con errores (no se importan): <strong data-testid="importar-n-errores">{totals.errores}</strong></li>
        {totals.avisos > 0 && <li>Con avisos (se importan sin ese dato): <strong>{totals.avisos}</strong></li>}
        {(totals.notas + totals.notasMal) > 0 && <li>Evoluciones: <strong>{totals.notas}</strong> listas{totals.notasMal ? `, ${totals.notasMal} con problemas` : ""}</li>}
        {(totals.citas + totals.citasMal) > 0 && <li>Citas: <strong>{totals.citas}</strong> listas{totals.citasMal ? `, ${totals.citasMal} con problemas` : ""}</li>}
      </ul>
      {totals.existen > 0 && <fieldset className="space-y-1"><legend className="text-sm font-semibold text-[#2b2540]">Si el RUT ya existe en tu cuenta</legend>
        {([["omitir", "Omitir (no tocar la ficha)"], ["completar", "Actualizar solo los campos vacíos"]] as const).map(([value, label]) => <label key={value} className="flex min-h-11 items-center gap-2 text-base"><input type="radio" name="importar-modo" className="size-5" checked={mode === value} onChange={() => setMode(value)} />{label}</label>)}
      </fieldset>}
      {existing === null && <p className="text-xs text-[#6b6a7c]">Comprobando fichas existentes…</p>}
      {progress ? <p role="status" className="text-sm text-[#473a6d]" data-testid="importar-progreso">Importando… {progress} No cierres esta página.</p>
        : !confirming ? <Button type="button" className="min-h-11 bg-[#473a6d] text-base hover:bg-[#3a2f5a]" disabled={!anything || existing === null} onClick={() => setConfirming(true)} data-testid="importar-pacientes-iniciar">Importar</Button>
        : <div className="space-y-2 rounded-lg border border-[#e2dfea] bg-white p-3" role="alertdialog" aria-label="Confirmar importación">
          <p className="text-sm text-[#35343f]">Se crearán {totals.nuevos} fichas{totals.existen ? (mode === "completar" ? ` y se completarán hasta ${totals.existen} existentes` : `; ${totals.existen} existentes se omiten`) : ""}{totals.notas ? `, ${totals.notas} evoluciones` : ""}{totals.citas ? `, ${totals.citas} citas` : ""}. ¿Confirmas?</p>
          <div className="flex flex-wrap gap-2"><Button type="button" className="min-h-11 bg-[#473a6d] text-base hover:bg-[#3a2f5a]" onClick={() => void runImport()} data-testid="importar-pacientes-confirmar">Confirmar e importar</Button><Button type="button" variant="outline" className="min-h-11 text-base" onClick={() => setConfirming(false)}>Cancelar</Button></div>
        </div>}
    </div>}

    {summary && <div className="space-y-2 rounded-lg bg-[#eef7f1] p-3 text-sm text-[#1f5133]" role="status" data-testid="importar-pacientes-resultado">
      <p className="flex items-center gap-1 font-semibold"><CheckCircle2 className="size-4" aria-hidden />Importación terminada</p>
      <p data-testid="importar-r-pacientes">Pacientes: {summary.pacientes.creados} creados, {summary.pacientes.actualizados} actualizados, {summary.pacientes.omitidos} omitidos, {summary.pacientes.errores} con error.</p>
      {(summary.evoluciones.creados + summary.evoluciones.omitidos + summary.evoluciones.errores) > 0 && <p>Evoluciones: {summary.evoluciones.creados} importadas, {summary.evoluciones.omitidos} ya estaban, {summary.evoluciones.errores} con error.</p>}
      {(summary.citas.creados + summary.citas.omitidos + summary.citas.errores) > 0 && <p>Citas: {summary.citas.creados} en la agenda, {summary.citas.omitidos} ya estaban, {summary.citas.errores} con error. (No se copian a Google Calendar.)</p>}
      {summary.noImportado.length > 0 && <div className="text-[#6b4e12]"><p className="flex items-center gap-1 font-semibold"><AlertTriangle className="size-4" aria-hidden />No importado aún</p><ul className="list-inside list-disc">{summary.noImportado.map(item => <li key={item}>{item}</li>)}</ul></div>}
      {summary.failedBatches > 0 && <p className="text-[#8a2f3c]">{summary.failedBatches} lotes fallaron por conexión. Vuelve a importar el mismo archivo: lo ya guardado no se duplica.</p>}
      {summary.rejected.length > 0 && <Button type="button" variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal py-2 text-left text-base" onClick={download} data-testid="importar-descargar-rechazadas"><Download className="mr-1 size-4" aria-hidden />Descargar filas rechazadas ({summary.rejected.length}) en CSV</Button>}
      <Button type="button" variant="outline" className="min-h-11 text-base" onClick={() => { setSheets([]); setSummary(null); }}>Importar otro archivo</Button>
    </div>}
  </section>;
}
