"use client";

import { useEffect, useState, type ReactNode } from "react";
import { Activity, Ban, BarChart3, CalendarCheck, CalendarDays, CalendarX, Info, UserPlus, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { chileTodayIso } from "@/lib/dictation/voice-command";
import { clp, type Bar, type Dashboard, type Slice } from "@/lib/dashboard";

const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

/** (i) con explicación: se abre al pasar el mouse, con foco o con un toque (iPhone). */
function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return <span className="relative inline-flex">
    <button type="button" aria-label={`Qué mide: ${text}`} onClick={() => setOpen(value => !value)} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)} onBlur={() => setOpen(false)}
      className="inline-flex size-5 items-center justify-center rounded-full text-[#473a6d] hover:bg-[#efeef4]"><Info className="size-4" aria-hidden="true"/></button>
    {open && <span role="tooltip" className="absolute left-1/2 top-6 z-30 w-64 -translate-x-1/2 rounded-lg bg-[#26243a] px-3 py-2 text-left text-xs font-normal normal-case leading-5 tracking-normal text-white shadow-lg">{text}</span>}
  </span>;
}

function arc(cx: number, cy: number, r: number, start: number, end: number) {
  const p = (a: number) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const [x1, y1] = p(start), [x2, y2] = p(end);
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${end - start > Math.PI ? 1 : 0} 1 ${x2} ${y2} Z`;
}

/** Torta SVG liviana con leyenda a la derecha (como Dentalsoft) y detalle al pasar o tocar. */
function Pie({ slices, money = false, empty }: { slices: Slice[]; money?: boolean; empty: string }) {
  const [active, setActive] = useState<number | null>(null);
  const total = slices.reduce((sum, s) => sum + s.value, 0);
  if (!total) return <p className="flex min-h-36 items-center justify-center px-4 text-center text-sm text-[#6b6a7c]">{empty}</p>;
  const angles = slices.reduce<number[]>((acc, slice) => [...acc, acc[acc.length - 1] + (slice.value / total) * Math.PI * 2], [0]);
  const shown = active !== null ? slices[active] : null;
  const fmt = (s: Slice) => money ? clp(s.value) : `${s.value.toLocaleString("es-CL")}`;
  return <div className="flex flex-col items-center gap-3 p-3 sm:flex-row sm:items-start sm:justify-center">
    <div className="relative">
      <svg viewBox="0 0 120 120" className="size-36" role="img" aria-label={slices.map(s => `${s.label}: ${fmt(s)}`).join(", ")}>
        {slices.map((s, i) => {
          const start = angles[i], end = angles[i + 1];
          const common = { fill: s.color, stroke: "#fff", strokeWidth: 1, onMouseEnter: () => setActive(i), onMouseLeave: () => setActive(null), onClick: () => setActive(current => current === i ? null : i), className: "cursor-pointer transition-opacity", opacity: active === null || active === i ? 1 : 0.55 };
          return s.value === total ? <circle key={s.label} cx={60} cy={60} r={56} {...common}/> : <path key={s.label} d={arc(60, 60, 56, start, end)} {...common}/>;
        })}
      </svg>
      {shown && <span className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-md bg-[#26243a]/90 px-2 py-1 text-xs font-semibold text-white">{shown.label}: {fmt(shown)} ({Math.round(shown.value / total * 100)}%)</span>}
    </div>
    <ul className="space-y-1 rounded-md bg-[#f6f5fa] px-2 py-1.5 text-xs text-[#35343f]">
      {slices.map((s, i) => <li key={s.label} className="flex items-center gap-1.5" onMouseEnter={() => setActive(i)} onMouseLeave={() => setActive(null)}>
        <span className="inline-block size-2.5 rounded-full ring-2 ring-white" style={{ background: s.color }} aria-hidden="true"/>{s.label}<span className="text-[#6b6a7c]">· {fmt(s)}</span>
      </li>)}
    </ul>
  </div>;
}

/** Porcentaje de confirmación del mes y barras por semana, con las citas próximas que aún no confirman. */
function ConfirmationRate({ rate, weeks, pending }: { rate: number | null; weeks: Dashboard["citas"]["confirmationWeeks"]; pending: Dashboard["citas"]["confirmationPending"] }) {
  if (rate === null) return <p className="flex min-h-36 items-center justify-center px-4 text-center text-sm text-[#6b6a7c]">Sin citas en el período.</p>;
  return <div className="space-y-3 p-3" data-testid="confirmation-rate">
    <p className="text-center"><strong className="text-3xl font-semibold text-[#0e7a99]" data-testid="confirmation-rate-value">{rate} %</strong><span className="ml-2 text-xs text-[#6b6a7c]">de las citas del mes</span></p>
    <ul className="space-y-1.5">
      {weeks.map(week => <li key={week.from} className="text-xs text-[#35343f]" data-testid="confirmation-week">
        <div className="flex items-center justify-between gap-2"><span>{week.label}</span><span className="tabular-nums text-[#6b6a7c]">{week.confirmed} de {week.scheduled} · {week.percent} %</span></div>
        <div className="mt-0.5 h-2 overflow-hidden rounded-full bg-[#e8e7ee]" role="img" aria-label={`${week.percent} % confirmadas`}><div className="h-full rounded-full bg-[#0e9bc2]" style={{ width: `${week.percent ?? 0}%` }}/></div>
      </li>)}
    </ul>
    {(pending.awaiting > 0 || pending.unnotified > 0) && <p className="rounded-md bg-[#f6f5fa] px-2 py-1.5 text-xs text-[#35343f]" data-testid="confirmation-pending">Próximas citas por confirmar: {pending.awaiting} esperando respuesta · {pending.unnotified} sin avisar</p>}
  </div>;
}

function Card({ title, info, children }: { title: string; info: string; children: ReactNode }) {
  return <section className="min-w-0 overflow-visible rounded-lg border border-[#dddbe6] bg-white">
    <h3 className="flex items-center justify-center gap-1 border-b-2 border-[#0e9bc2] bg-[#f6f5fa] px-3 py-2 text-sm font-semibold text-[#35343f]"><InfoTip text={info}/>{title}</h3>
    {children}
  </section>;
}

function Kpi({ icon, label, value, info, hint }: { icon: ReactNode; label: string; value: number | null; info: string; hint?: string }) {
  return <div className="flex min-w-0 items-center gap-3 rounded-lg border border-[#ebeaf1] bg-white px-3 py-2">
    <span className="flex size-11 shrink-0 items-center justify-center rounded-full border-2 border-[#c9c7d6] text-[#473a6d]">{icon}</span>
    <div className="min-w-0">
      <p className="flex items-center gap-1 text-xs text-[#615f73]"><InfoTip text={info}/>{label}:</p>
      {value === null ? <p className="text-sm font-semibold text-[#8b8ca3]" title={hint}>Sin datos</p> : <p className="text-2xl font-semibold leading-7 text-[#26243a]">{value.toLocaleString("es-CL")}</p>}
      {value === null && hint && <p className="text-[11px] leading-4 text-[#8b8ca3]">{hint}</p>}
    </div>
  </div>;
}

/** Barras horizontales con detalle «$ 8.638.425 (Nombre)» al pasar o tocar. */
function Bars({ bars, empty }: { bars: Bar[]; empty: string }) {
  const [active, setActive] = useState<string | null>(null);
  if (!bars.length) return <p className="p-4 text-sm text-[#6b6a7c]">{empty}</p>;
  const max = Math.max(...bars.map(b => b.amount));
  return <ul className="space-y-2 p-3">
    {bars.map(b => <li key={b.label} className="grid grid-cols-[minmax(90px,30%)_1fr] items-center gap-2 text-xs sm:grid-cols-[200px_1fr]">
      <span className="truncate text-right font-medium uppercase text-[#35343f]" title={b.label}>{b.label}</span>
      <button type="button" className="relative h-6 w-full rounded bg-[#f3f1f7] text-left" onMouseEnter={() => setActive(b.label)} onMouseLeave={() => setActive(null)} onClick={() => setActive(current => current === b.label ? null : b.label)} aria-label={`${clp(b.amount)} (${b.label})`}>
        <span className="block h-full rounded bg-[#0e9bc2]" style={{ width: `${Math.max(2, b.amount / max * 100)}%` }}/>
        {active === b.label && <span role="tooltip" className="absolute -top-8 left-2 z-20 whitespace-nowrap rounded-md bg-[#26243a] px-2 py-1 text-xs font-semibold text-white shadow">{clp(b.amount)} ({b.label})</span>}
      </button>
    </li>)}
  </ul>;
}

function SectionTitle({ icon, title, extra }: { icon: ReactNode; title: string; extra?: ReactNode }) {
  return <h2 className="flex flex-wrap items-center gap-2 border-b border-[#ebeaf1] pb-2 text-lg font-semibold text-[#26243a]">{icon}{title}{extra}</h2>;
}

export function DashboardPanel() {
  const today = chileTodayIso();
  const [ty, tm] = today.split("-").map(Number);
  const [month, setMonth] = useState(tm), [year, setYear] = useState(ty), [professional, setProfessional] = useState("");
  const [query, setQuery] = useState({ month: tm, year: ty, professional: "" });
  const [state, setState] = useState<{ key: string; data: Dashboard | null; error: string } | null>(null);
  const key = `${query.year}-${query.month}-${query.professional}`;
  useEffect(() => {
    let live = true;
    const controller = new AbortController();
    fetch(`/api/dashboard?mes=${query.month}&anio=${query.year}${query.professional ? `&profesional=${encodeURIComponent(query.professional)}` : ""}`, { cache: "no-store", signal: controller.signal })
      .then(async r => { const d = await r.json().catch(() => ({})) as Dashboard & { error?: string }; if (!r.ok) throw new Error(d.error || "No se pudo cargar el dashboard."); return d; })
      .then(data => { if (live) setState({ key, data, error: "" }); })
      .catch(cause => { if (live && !controller.signal.aborted) setState({ key, data: null, error: cause instanceof Error ? cause.message : "No se pudo cargar el dashboard." }); });
    return () => { live = false; controller.abort(); };
  }, [key, query]);
  const current = state?.key === key ? state : null;
  const d = current?.data ?? null;
  const years = Array.from({ length: 6 }, (_, i) => ty - 4 + i);
  const s = d?.citas.stats;
  const select = "h-10 rounded-md border border-[#c9c7d6] bg-white px-2 text-base sm:h-9 sm:text-sm";

  return <div className="space-y-6" data-testid="dashboard-panel">
    <div className="surface grid gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold text-[#26243a]"><BarChart3 className="size-5 text-[#473a6d]"/>Dashboard</h1>
        <p className="mt-1 text-sm text-[#615f73]">Estadísticas de efectividad, ingresos e información relevante sobre acciones realizadas según sucursal y grupo etario, con apoyo gráfico.</p>
      </div>
      <form className="flex flex-wrap items-center gap-2" onSubmit={event => { event.preventDefault(); setQuery({ month, year, professional }); }}>
        {d && d.professionals.length > 1 && <select aria-label="Profesional" className={select} value={professional} onChange={e => setProfessional(e.target.value)}><option value="">Todos los profesionales</option>{d.professionals.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select>}
        <select aria-label="Mes" className={select} value={month} onChange={e => setMonth(Number(e.target.value))} data-testid="dashboard-month">{MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}</select>
        <select aria-label="Año" className={select} value={year} onChange={e => setYear(Number(e.target.value))}>{years.map(y => <option key={y} value={y}>{y}</option>)}</select>
        <Button type="submit" className="rounded-full bg-[#0e9bc2] px-5 hover:bg-[#0b85a7]" data-testid="dashboard-filter">Filtrar</Button>
      </form>
    </div>
    {current?.error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm text-rose-900">{current.error}</p>}
    {!current && <p role="status" className="text-sm text-[#6b6a7c]">Cargando dashboard…</p>}
    {d && s && <>
      <section className="surface space-y-4">
        <SectionTitle icon={<CalendarDays className="size-5 text-[#473a6d]"/>} title="Agenda"/>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          <Card title="Efectividad de citas" info="Citas del mes no canceladas: asistidas (marcadas «Atendida» o con evolución del paciente ese día), no asistidas (marcadas «Inasistida») y pasadas sin registro. No se suponen inasistencias.">
            <Pie slices={d.citas.effectiveness} empty="Sin citas pasadas en el período."/>
          </Card>
          <Card title="Citas confirmadas" info="Citas del mes no canceladas que el paciente confirmó (correo de confirmación o marca en la agenda) versus las que no.">
            <Pie slices={d.citas.confirmation} empty="Sin citas en el período."/>
          </Card>
          <Card title="Tasa de confirmación" info="Citas del mes no canceladas que el paciente confirmó (por WhatsApp, correo o marca en la agenda) o que ya llegaron, sobre el total, semana a semana. «Esperando respuesta» son citas de hoy en adelante ya avisadas; «Sin avisar», las que aún no se les pide confirmar.">
            <ConfirmationRate rate={d.citas.confirmationRate} weeks={d.citas.confirmationWeeks} pending={d.citas.confirmationPending}/>
          </Card>
          <Card title="Tipos de atención" info="Según el motivo de la cita (urgencia, control, diagnóstico, tratamiento, ortodoncia…). Las citas de Google Calendar sin motivo reconocible quedan como «Sin especificar».">
            <Pie slices={d.citas.types} empty="Sin citas en el período."/>
          </Card>
        </div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5">
          <Kpi icon={<UserPlus className="size-5"/>} label="Pacientes creados" value={d.kpis.patientsCreated} info="Fichas de pacientes creadas en el mes."/>
          <Kpi icon={<CalendarDays className="size-5"/>} label="Citas agendadas" value={d.kpis.scheduled} info="Citas del mes (Google Calendar y citas de la ficha) que no fueron canceladas."/>
          <Kpi icon={<CalendarCheck className="size-5"/>} label="Citas efectivas" value={d.kpis.effective} info="Citas marcadas «Atendida» o en que el paciente tiene una evolución registrada ese mismo día."/>
          <Kpi icon={<CalendarX className="size-5"/>} label="Citas canceladas" value={d.kpis.cancelled} info="Canceladas en Google Calendar, marcadas «Cancelada» en la agenda o en que el paciente avisó por correo que no asistirá."/>
          <Kpi icon={<Ban className="size-5"/>} label="Citas inasistidas" value={d.kpis.noShow} info="Citas marcadas «Inasistida» en la agenda." hint={s.noRecord ? `${s.noRecord} cita(s) pasada(s) sin registro de asistencia: márcalas en la Agenda.` : "Marca la asistencia en la Agenda."}/>
        </div>
      </section>

      <section className="surface space-y-4">
        <SectionTitle icon={<Wallet className="size-5 text-[#473a6d]"/>} title="Pagos" extra={<span className="flex items-center gap-1 border-l border-[#dddbe6] pl-2 text-base font-normal text-[#615f73]"><InfoTip text="Planes de tratamiento principales creados en el mes (no cuenta alternativas)."/>Presupuestos creados: {d.pagos.budgetsCreated}</span>}/>
        <div className="grid gap-3 lg:grid-cols-3">
          <Card title="Ingresos" info={`Pagos y abonos registrados en el mes por medio de pago. Total: ${clp(d.pagos.incomeTotal)}.`}>
            <Pie slices={d.pagos.income} money empty="Sin pagos registrados en el período."/>
            {d.pagos.incomeTotal > 0 && <p className="pb-3 text-center text-sm font-semibold text-[#26243a]">Total {clp(d.pagos.incomeTotal)}</p>}
          </Card>
          <Card title="Devoluciones y anulaciones" info="Devoluciones de dinero y pagos anulados del período. Gestión Dental aún no registra devoluciones ni anulación de pagos.">
            <p className="flex min-h-36 items-center justify-center px-4 text-center text-sm text-[#35343f]">No existen devoluciones ni anulaciones en el período seleccionado.</p>
          </Card>
          <Card title="Presupuestos" info="Planes creados en el mes según su estado actual: Pendientes (sin iniciar o expirados), Iniciados (con alguna prestación realizada) y Terminados (todo realizado o dado de alta).">
            <Pie slices={d.pagos.budgets} empty="Sin presupuestos creados en el período."/>
          </Card>
        </div>
        <div className="rounded-lg border border-[#dddbe6]">
          <h3 className="flex items-center gap-1 border-b border-[#ebeaf1] px-3 py-2 text-sm font-semibold"><BarChart3 className="size-4"/><InfoTip text="A la fecha: lo realizado y aún no pagado en los planes de cada profesional (autor del presupuesto). No incluye lo presupuestado que no se ha hecho."/>Saldos por profesional</h3>
          <Bars bars={d.pagos.balancesByProfessional} empty="Sin saldos pendientes."/>
        </div>
        <div className="rounded-lg border border-[#dddbe6]">
          <h3 className="flex items-center gap-1 border-b border-[#ebeaf1] px-3 py-2 text-sm font-semibold"><BarChart3 className="size-4"/><InfoTip text="A la fecha: lo realizado y aún no pagado, agrupado por el convenio o la previsión de la ficha de ingreso del paciente."/>Saldos por convenio / previsión</h3>
          {d.pagos.balancesByInsurance ? <Bars bars={d.pagos.balancesByInsurance} empty="Sin saldos pendientes."/> : <p className="p-4 text-sm text-[#6b6a7c]">Sin datos: registra el convenio o la previsión en la ficha de ingreso de los pacientes (Editar datos).</p>}
        </div>
      </section>

      <section className="surface space-y-4">
        <SectionTitle icon={<Activity className="size-5 text-[#473a6d]"/>} title="Acciones" extra={<span className="flex items-center gap-1 border-l border-[#dddbe6] pl-2 text-base font-normal text-[#615f73]"><InfoTip text="Prestaciones de los planes marcadas como realizadas en el mes."/>Acciones tratadas: {d.acciones.total}</span>}/>
        <div className="grid gap-3 md:grid-cols-2">
          <Card title="Acciones por grupo etario" info="Prestaciones realizadas en el mes según la edad del paciente ese día: menor de 17, 17 a 40 y mayor de 40 años.">
            <Pie slices={d.acciones.byAge} empty="Sin acciones realizadas en el período."/>
          </Card>
          <Card title="Acciones por sucursal" info="Prestaciones realizadas en el mes según la sucursal de la ficha de ingreso; si no tiene, la clínica.">
            <Pie slices={d.acciones.byBranch} empty="Sin acciones realizadas en el período."/>
          </Card>
        </div>
      </section>
    </>}
  </div>;
}
