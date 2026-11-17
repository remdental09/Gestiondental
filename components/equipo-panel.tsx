"use client";

import { useCallback, useEffect, useState } from "react";
import { Building2, Check, Copy, Mail, MessageCircle, RefreshCw, UserPlus, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type Role = "admin" | "dentista";
type Member = { email: string; name: string; role: Role; roleLabel: string; status: "invitada" | "activa" | "revocada" | "rechazada" | "vencida"; invitedAt: string; acceptedAt: string | null; expiresAt: string; isMe: boolean };
type TeamState = {
  space: { name: string; role: "titular" | Role; roleLabel: string; inClinic: boolean; manage: boolean };
  spaces: Array<{ id: string; name: string; current: boolean }>;
  invitations: Array<{ clinicId: string; clinicName: string; invitedBy: string; role: Role; roleLabel: string; expiresAt: string }>;
  team: { titular: string; members: Member[]; message: string };
  reload?: boolean;
  error?: string;
  /** Resultado del correo automático de invitación (solo en la respuesta a invitar o renovar). */
  mail?: { sent: true; to: string; from: string } | { sent: false; to: string; reason: "sin-correo" | "error"; detail?: string };
};

const STATUS_LABEL: Record<Member["status"], string> = { invitada: "Invitación pendiente", activa: "Activo", revocada: "Sin acceso", rechazada: "Rechazó", vencida: "Invitación vencida" };
const day = (iso: string) => new Intl.DateTimeFormat("es-CL", { dateStyle: "medium", timeZone: "America/Santiago" }).format(new Date(iso));

async function call(body: Record<string, unknown>): Promise<TeamState> {
  const response = await fetch("/api/equipo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await response.json().catch(() => ({})) as TeamState;
  if (!response.ok) throw new Error(data.error || "No se pudo guardar el cambio.");
  return data;
}

function useTeam() {
  const [state, setState] = useState<TeamState | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let live = true;
    fetch("/api/equipo", { cache: "no-store" })
      .then(async response => {
        const data = await response.json() as TeamState;
        if (!response.ok) throw new Error(data.error || "No se pudo leer el equipo.");
        if (live) { setState(data); setError(""); }
      })
      .catch(e => { if (live) setError(e instanceof Error ? e.message : "No se pudo leer el equipo."); });
    return () => { live = false; };
  }, []);
  const act = useCallback(async (body: Record<string, unknown>) => {
    setBusy(true); setError("");
    try {
      const data = await call(body);
      // Cambió el espacio de trabajo: se recarga para leer las fichas del nuevo espacio.
      if (data.reload) { window.location.reload(); return true; }
      setState(data); return true;
    } catch (e) { setError(e instanceof Error ? e.message : "No se pudo guardar el cambio."); return false; }
    finally { setBusy(false); }
  }, []);
  return { state, error, busy, act };
}

/**
 * Franja superior: invitaciones recibidas (aceptar o rechazar) y, si la persona trabaja en más de un espacio,
 * el selector «Trabajando en». No aparece si no hay nada que mostrar.
 */
export function ClinicSpaceBar() {
  const { state, error, busy, act } = useTeam();
  if (!state) return null;
  const several = state.spaces.length > 1;
  if (!state.invitations.length && !several) return null;
  return (
    <div className="mb-5 space-y-3" data-testid="clinic-space-bar">
      {state.invitations.map(inv => (
        <section key={inv.clinicId} className="flex flex-wrap items-center gap-3 rounded-xl border border-[#c9c2e3] bg-[#efedf7] p-4" aria-label="Invitación a una clínica" data-testid="clinic-invitation">
          <Building2 className="size-5 shrink-0 text-[#473a6d]" aria-hidden="true"/>
          <p className="min-w-0 flex-1 text-sm text-[#2b2540]"><strong>{inv.invitedBy}</strong> te invitó a atender pacientes de <strong>{inv.clinicName}</strong> como {inv.roleLabel.toLowerCase()}. Vence el {day(inv.expiresAt)}.</p>
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={busy} className="bg-[#473a6d] text-white hover:bg-[#3a2f5a]" onClick={() => act({ action: "aceptar", clinicId: inv.clinicId })} data-testid="accept-invitation"><Check className="mr-1.5 size-4"/>Aceptar</Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => act({ action: "rechazar", clinicId: inv.clinicId })}>Rechazar</Button>
          </div>
        </section>
      ))}
      {several && (
        <label className="flex flex-wrap items-center gap-2 text-sm text-[#57566a]">
          <span className="font-medium">Trabajando en</span>
          <select className="min-h-10 rounded-lg border border-[#dddbe6] bg-white px-3 text-base font-semibold text-[#473a6d] sm:text-sm" disabled={busy} value={state.spaces.find(s => s.current)?.id ?? ""} onChange={e => act({ action: "espacio", spaceId: e.target.value })} data-testid="space-switcher">
            {state.spaces.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
      )}
      {error && <p role="alert" className="text-sm text-rose-800">{error}</p>}
    </div>
  );
}

/** Configuración → Equipo: invitar colegas por su Gmail, ver el estado de cada uno, cambiar su rol o quitarle el acceso. */
export function EquipoPanel() {
  const { state, error, busy, act } = useTeam();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("dentista");
  const [invited, setInvited] = useState("");
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [copied, setCopied] = useState(false);

  if (!state) return <section className="surface text-sm text-[#6b6a7c]" role="status">{error || "Cargando equipo…"}</section>;
  const { space, team } = state;
  const sentMail = state.mail && state.mail.to === invited ? state.mail : null;

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    const target = email.trim().toLowerCase();
    if (await act({ action: "invitar", email: target, role })) { setInvited(target); setEmail(""); setCopied(false); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(team.message); setCopied(true); } catch { setCopied(false); }
  }

  const visible = team.members.filter(m => m.status !== "revocada" && m.status !== "rechazada");
  const past = team.members.filter(m => m.status === "revocada" || m.status === "rechazada");

  return (
    <section className="surface space-y-5" aria-labelledby="equipo-titulo" data-testid="team-panel">
      <div>
        <h3 id="equipo-titulo" className="flex items-center gap-2 text-base font-semibold text-[#2b2540]"><Users className="size-5 text-[#473a6d]"/>Equipo de la clínica</h3>
        <p className="mt-1 text-sm text-[#615f73]">
          {space.manage
            ? "Invita a otros dentistas a atender a los pacientes de esta clínica. Entran con su propio Gmail; cada evolución queda firmada por quien la escribe y solo esa persona puede corregirla."
            : `Trabajas en ${space.name} como ${space.roleLabel.toLowerCase()}. Ves a sus pacientes y tus evoluciones quedan a tu nombre.`}
        </p>
      </div>

      <ul className="divide-y divide-[#ebeaf1] rounded-xl border border-[#e6e4ee]" aria-label="Personas del equipo">
        <li className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"><span><strong className="text-[#35343f]">{team.titular}</strong> <span className="text-[#6b6a7c]">· Titular</span></span></li>
        {visible.map(m => (
          <li key={m.email} className="flex flex-wrap items-center gap-2 p-3 text-sm" data-testid="team-member">
            <span className="min-w-0 flex-1"><strong className="block truncate text-[#35343f]">{m.name || m.email}{m.isMe ? " (tú)" : ""}</strong><span className="block truncate text-xs text-[#6b6a7c]">{m.email} · {STATUS_LABEL[m.status]}{m.status === "invitada" ? ` hasta el ${day(m.expiresAt)}` : ""}</span></span>
            {space.manage && !m.isMe ? (
              <span className="flex flex-wrap items-center gap-2">
                <select aria-label={`Rol de ${m.email}`} className="min-h-9 rounded-lg border border-[#dddbe6] bg-white px-2 text-sm" disabled={busy || m.status === "vencida"} value={m.role} onChange={e => act({ action: "rol", email: m.email, role: e.target.value })}>
                  <option value="dentista">Dentista</option><option value="admin">Administrador</option>
                </select>
                {(m.status === "invitada" || m.status === "vencida") && <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={async () => { if (await (m.status === "vencida" ? act({ action: "invitar", email: m.email, role: m.role }) : act({ action: "reenviar", email: m.email }))) { setInvited(m.email); setCopied(false); } }}><RefreshCw className="mr-1 size-4"/>{m.status === "vencida" ? "Renovar plazo" : "Renovar y reenviar"}</Button>}
                {confirmRemove === m.email
                  ? <span className="flex items-center gap-1 rounded-lg bg-rose-50 px-2 py-1 text-rose-900">¿Desea quitar el acceso a {m.name || m.email}?<Button type="button" size="sm" variant="ghost" className="text-rose-800" disabled={busy} onClick={async () => { await act({ action: "revocar", email: m.email }); setConfirmRemove(null); }}>Sí, quitar</Button><Button type="button" size="sm" variant="ghost" onClick={() => setConfirmRemove(null)}>No</Button></span>
                  : <Button type="button" size="sm" variant="ghost" className="text-[#a43542] hover:bg-rose-50" disabled={busy} onClick={() => setConfirmRemove(m.email)} data-testid="team-remove"><X className="mr-1 size-4"/>{m.status === "activa" ? "Quitar acceso" : "Anular invitación"}</Button>}
              </span>
            ) : <span className="text-xs text-[#6b6a7c]">{m.roleLabel}</span>}
          </li>
        ))}
      </ul>

      {space.manage && (
        <form onSubmit={invite} className="space-y-3 rounded-xl border border-[#e6e4ee] bg-[#f7f6fa] p-4" data-testid="team-invite">
          <h4 className="flex items-center gap-2 text-sm font-semibold text-[#2b2540]"><UserPlus className="size-4"/>Invitar a un colega</h4>
          <div className="flex flex-wrap gap-2">
            <input type="email" required inputMode="email" autoComplete="off" placeholder="correo@gmail.com" value={email} onChange={e => setEmail(e.target.value)} aria-label="Gmail del colega" className="min-h-11 min-w-[14rem] flex-1 rounded-lg border border-[#d2d4df] bg-white px-3 text-base sm:text-sm"/>
            <select value={role} onChange={e => setRole(e.target.value as Role)} aria-label="Rol" className="min-h-11 rounded-lg border border-[#d2d4df] bg-white px-3 text-base sm:text-sm">
              <option value="dentista">Dentista</option><option value="admin">Administrador</option>
            </select>
            <Button type="submit" disabled={busy || !email.trim()} className="min-h-11 bg-[#473a6d] text-white hover:bg-[#3a2f5a]">Invitar</Button>
          </div>
          <p className="text-xs text-[#6b6a7c]">El colega entra a la app con «Entrar con Google» usando ese mismo correo y acepta. No necesita configurar nada. El administrador además puede invitar y quitar personas.</p>
          {invited && team.message && (
            <div className="space-y-2 rounded-lg border border-[#c9c2e3] bg-white p-3 text-sm" role="status">
              {sentMail?.sent
                ? <p className="text-[#2b2540]" data-testid="invite-mail-sent"><Check className="mr-1 inline size-4 text-emerald-700"/>Correo de invitación enviado a <strong>{invited}</strong> desde {sentMail.from}. Si quieres, avísale también por:</p>
                : sentMail && sentMail.reason === "error"
                  ? <p className="text-amber-900" data-testid="invite-mail-error">La invitación quedó lista, pero Gmail no envió el correo ({sentMail.detail}). Avísale por:</p>
                  : <p className="text-[#2b2540]" data-testid="invite-mail-none">Invitación lista para <strong>{invited}</strong>. Para que el correo salga solo, conecta un Gmail en Agenda → «Correo de confirmación de citas». Por ahora avísale por:</p>}
              <div className="flex flex-wrap gap-2">
                <a className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[#dddbe6] px-3 font-medium text-[#473a6d] hover:bg-[#efedf7]" href={`https://wa.me/?text=${encodeURIComponent(team.message)}`} target="_blank" rel="noopener noreferrer"><MessageCircle className="size-4"/>WhatsApp</a>
                <a className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[#dddbe6] px-3 font-medium text-[#473a6d] hover:bg-[#efedf7]" href={`mailto:${encodeURIComponent(invited)}?subject=${encodeURIComponent("Invitación a SpeakDent")}&body=${encodeURIComponent(team.message)}`}><Mail className="size-4"/>Correo</a>
                <button type="button" onClick={copy} className="inline-flex min-h-9 items-center gap-1 rounded-lg border border-[#dddbe6] px-3 font-medium text-[#473a6d] hover:bg-[#efedf7]"><Copy className="size-4"/>{copied ? "Copiado" : "Copiar mensaje"}</button>
              </div>
            </div>
          )}
        </form>
      )}

      {space.inClinic && (
        confirmLeave
          ? <p className="flex flex-wrap items-center gap-2 rounded-lg bg-rose-50 p-3 text-sm text-rose-900">¿Desea salir de {space.name}? Tus evoluciones quedan en las fichas con tu nombre.<Button type="button" size="sm" variant="ghost" className="text-rose-800" disabled={busy} onClick={() => act({ action: "salir" })}>Sí, salir</Button><Button type="button" size="sm" variant="ghost" onClick={() => setConfirmLeave(false)}>No</Button></p>
          : <Button type="button" variant="ghost" size="sm" className="text-[#a43542] hover:bg-rose-50" onClick={() => setConfirmLeave(true)}>Salir de esta clínica</Button>
      )}

      {space.manage && past.length > 0 && (
        <details className="text-sm text-[#615f73]"><summary className="cursor-pointer">Historial ({past.length})</summary>
          <ul className="mt-2 space-y-1">{past.map(m => <li key={m.email}>{m.name || m.email} · {STATUS_LABEL[m.status]}</li>)}</ul>
        </details>
      )}
      {error && <p role="alert" className="text-sm text-rose-800">{error}</p>}
    </section>
  );
}
