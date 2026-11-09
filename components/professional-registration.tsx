"use client";
import { useState } from "react";
import { LogOut } from "lucide-react";
import { SPECIALTIES, checkProfile, displayName, formatRut, type ClinicianProfile } from "@/lib/clinician-profile";

/** Registro mínimo en el primer ingreso: nombre, apellido, RUT y especialidad. Bloquea la app hasta completarlo. */
export function ProfessionalRegistration({ email, onSaved }: { email: string; onSaved: (profile: ClinicianProfile) => void }) {
  const [form, setForm] = useState({ firstName: "", lastName: "", rut: "", specialty: "" });
  const [error, setError] = useState(""), [saving, setSaving] = useState(false), [connectDrive, setConnectDrive] = useState(true);
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const field = "mt-1 block min-h-11 w-full rounded-lg border border-[#cddadc] bg-white px-3 text-base text-[#20343b] focus-visible:outline-2 focus-visible:outline-[#087f83]";

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const checked = checkProfile(form);
    if (!checked.ok) { setError(checked.error); return; }
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const data = (await response.json().catch(() => ({}))) as { error?: string; profile?: ClinicianProfile };
      if (!response.ok) { setError(data.error || "No se pudo guardar. Inténtalo de nuevo."); return; }
      onSaved(data.profile as ClinicianProfile);
      // Con la casilla marcada, sigue a Google para dar el permiso de Drive con la misma cuenta.
      if (connectDrive) window.location.assign("/api/drive/connect?auto=1");
    } catch {
      setError("No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="registro-titulo" className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#0f2a30]/70 p-4 sm:items-center">
      <form onSubmit={submit} className="my-6 w-full max-w-md rounded-2xl bg-white p-6 shadow-xl" noValidate>
        <p className="text-xs font-bold uppercase tracking-wide text-[#087f83]">Gestión Dental</p>
        <h2 id="registro-titulo" className="mt-1 text-2xl font-semibold text-[#20343b]">Completa tu registro</h2>
        <p className="mt-2 text-sm text-[#60757a]">Ingresaste como <strong className="text-[#20343b]">{email}</strong>. Necesitamos estos datos una sola vez para abrir tu ficha clínica.</p>
        <div className="mt-5 grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-medium text-[#20343b]">Nombre<input className={field} autoComplete="given-name" value={form.firstName} onChange={(e) => set("firstName")(e.target.value)} required /></label>
            <label className="text-sm font-medium text-[#20343b]">Apellido<input className={field} autoComplete="family-name" value={form.lastName} onChange={(e) => set("lastName")(e.target.value)} required /></label>
          </div>
          <label className="text-sm font-medium text-[#20343b]">RUT<input className={field} inputMode="text" autoComplete="off" placeholder="12.345.678-5" value={form.rut} onChange={(e) => set("rut")(e.target.value)} onBlur={() => set("rut")(formatRut(form.rut))} required /></label>
          <label className="text-sm font-medium text-[#20343b]">Especialidad
            <select className={field} value={form.specialty} onChange={(e) => set("specialty")(e.target.value)} required>
              <option value="">Elige una opción</option>
              {SPECIALTIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>
        <label className="mt-4 flex items-start gap-3 rounded-lg border border-[#cddadc] bg-[#f7fbfb] p-3 text-sm text-[#20343b]">
          <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-[#087f83]" checked={connectDrive} onChange={(e) => setConnectDrive(e.target.checked)} />
          <span><strong>Respaldar mis fichas en mi Google Drive</strong><span className="mt-1 block text-[#60757a]">Se conectará con <b>{email}</b> y guardará una copia automática de cada ficha. En el siguiente paso Google te pedirá permiso; marca la casilla de Drive. Puedes hacerlo después desde Inicio.</span></span>
        </label>
        {error && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
        <button type="submit" disabled={saving} className="mt-5 min-h-11 w-full rounded-lg bg-[#087f83] px-4 text-base font-semibold text-white hover:bg-[#066d71] disabled:opacity-60">{saving ? "Guardando…" : "Guardar y entrar"}</button>
        <p className="mt-3 text-center text-xs text-[#71858b]">Se mostrará como {form.firstName.trim() && form.lastName.trim() ? displayName(form) : "Dr(a). Nombre Apellido"}.</p>
        <a href="/cdn-cgi/access/logout" className="mt-4 flex items-center justify-center gap-2 text-sm font-medium text-[#53686e] hover:text-[#145b60]"><LogOut className="size-4" />No soy yo, entrar con otra cuenta</a>
      </form>
    </div>
  );
}
