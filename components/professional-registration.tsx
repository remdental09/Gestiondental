"use client";
import { useState } from "react";
import { LogOut } from "lucide-react";
import { SPECIALTIES, checkProfile, displayName, formatDocument, type ClinicianProfile, type ProfessionalDocumentType } from "@/lib/clinician-profile";

/** Registro mínimo en el primer ingreso: nombre, apellido, RUT y especialidad. Bloquea la app hasta completarlo. */
export function ProfessionalRegistration({ email, onSaved }: { email: string; onSaved: (profile: ClinicianProfile) => void }) {
  const [form, setForm] = useState({ firstName: "", lastName: "", rut: "", specialty: "", documentType: "rut" as ProfessionalDocumentType });
  const [error, setError] = useState(""), [saving, setSaving] = useState(false), [connectDrive, setConnectDrive] = useState(true), [connectCalendar, setConnectCalendar] = useState(true);
  const set = (key: keyof typeof form) => (value: string) => setForm((current) => ({ ...current, [key]: value }));
  const field = "mt-1 block min-h-11 w-full rounded-lg border border-[#d2d4df] bg-white px-3 text-base text-[#35343f] focus-visible:outline-2 focus-visible:outline-[#473a6d]";

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
      // Un solo paso en Google para las dos cosas: Drive (respaldo) y Calendar (agenda, solo lectura).
      if (connectDrive) window.location.assign("/api/drive/connect?auto=1" + (connectCalendar ? "&withCalendar=1" : ""));
      else if (connectCalendar) window.location.assign("/api/drive/connect?calendar=1&auto=1");
    } catch {
      setError("No se pudo conectar. Revisa tu conexión e inténtalo de nuevo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="registro-titulo" className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#0f2a30]/70 p-4 sm:items-center">
      <form onSubmit={submit} className="my-6 w-full max-w-md rounded-xl bg-white p-6 shadow-xl" noValidate>
        <p className="text-xs font-bold uppercase tracking-wide text-[#473a6d]">Gestión Dental</p>
        <h2 id="registro-titulo" className="mt-1 text-2xl font-semibold text-[#35343f]">Completa tu registro</h2>
        <p className="mt-2 text-sm text-[#615f73]">Ingresaste como <strong className="text-[#35343f]">{email}</strong>. Necesitamos estos datos una sola vez para abrir tu ficha clínica.</p>
        <div className="mt-5 grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-medium text-[#35343f]">Nombre<input className={field} autoComplete="given-name" value={form.firstName} onChange={(e) => set("firstName")(e.target.value)} required /></label>
            <label className="text-sm font-medium text-[#35343f]">Apellido<input className={field} autoComplete="family-name" value={form.lastName} onChange={(e) => set("lastName")(e.target.value)} required /></label>
          </div>
          <label className="text-sm font-medium text-[#35343f]">Tipo de documento
            <select className={field} value={form.documentType} onChange={(e) => setForm((c) => ({ ...c, documentType: e.target.value === "extranjero" ? "extranjero" : "rut", rut: formatDocument(c.rut, e.target.value === "extranjero" ? "extranjero" : "rut") }))} data-testid="professional-document-type">
              <option value="rut">RUT chileno</option>
              <option value="extranjero">Documento extranjero (DNI, cédula, DPI, pasaporte…)</option>
            </select>
          </label>
          <label className="text-sm font-medium text-[#35343f]">{form.documentType === "extranjero" ? "Número de documento" : "RUT"}<input className={field} inputMode="text" autoCapitalize="characters" autoComplete="off" placeholder={form.documentType === "extranjero" ? "Ej. 1-0234-0567, pasaporte…" : "12.345.678-5"} value={form.rut} onChange={(e) => set("rut")(e.target.value)} onBlur={() => set("rut")(formatDocument(form.rut, form.documentType))} data-testid="professional-document" /></label>
          <label className="text-sm font-medium text-[#35343f]">Especialidad
            <select className={field} value={form.specialty} onChange={(e) => set("specialty")(e.target.value)} required>
              <option value="">Elige una opción</option>
              {SPECIALTIES.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
        </div>
        <label className="mt-4 flex items-start gap-3 rounded-lg border border-[#d2d4df] bg-[#f7f6fa] p-3 text-sm text-[#35343f]">
          <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-[#473a6d]" checked={connectDrive} onChange={(e) => setConnectDrive(e.target.checked)} />
          <span><strong>Respaldar mis fichas en mi Google Drive</strong><span className="mt-1 block text-[#615f73]">Se conectará con <b>{email}</b> y guardará una copia automática de cada ficha. En el siguiente paso Google te pedirá permiso; marca la casilla de Drive. Puedes hacerlo después desde Inicio.</span></span>
        </label>
        <label className="mt-3 flex items-start gap-3 rounded-lg border border-[#d2d4df] bg-[#f7f6fa] p-3 text-sm text-[#35343f]">
          <input type="checkbox" className="mt-0.5 size-5 shrink-0 accent-[#473a6d]" checked={connectCalendar} onChange={(e) => setConnectCalendar(e.target.checked)} data-testid="registro-calendario" />
          <span><strong>Ver mis citas de Google Calendar en la agenda</strong><span className="mt-1 block text-[#615f73]">La app solo mira tus citas, no cambia nada, y se actualizan solas cada hora.</span></span>
        </label>
        {error && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
        <button type="submit" disabled={saving} className="mt-5 min-h-11 w-full rounded-lg bg-[#473a6d] px-4 text-base font-semibold text-white hover:bg-[#066d71] disabled:opacity-60">{saving ? "Guardando…" : "Guardar y entrar"}</button>
        <p className="mt-3 text-center text-xs text-[#6b6a7c]">Se mostrará como {form.firstName.trim() && form.lastName.trim() ? displayName(form) : "Dr(a). Nombre Apellido"}.</p>
        <a href="/auth/salir" className="mt-4 flex items-center justify-center gap-2 text-sm font-medium text-[#57566a] hover:text-[#473a6d]"><LogOut className="size-4" />No soy yo, entrar con otra cuenta</a>
      </form>
    </div>
  );
}
