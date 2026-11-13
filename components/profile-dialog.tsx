"use client";
import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { SPECIALTIES, checkProfile, displayName, formatDocument, professionalDocumentTypeOf, type ClinicianProfile, type ProfessionalDocumentType } from "@/lib/clinician-profile";

const field = "mt-1 block min-h-11 w-full rounded-lg border border-[#d2d4df] bg-white px-3 text-base text-[#35343f] focus-visible:outline-2 focus-visible:outline-[#473a6d]";

/** «Mi perfil»: el profesional corrige sus datos o suma un título. Queda ligado al correo con el que ingresó; el correo no se edita aquí. */
export function ProfileDialog({ email, onClose, onSaved }: { email: string; onClose: () => void; onSaved: (profile: ClinicianProfile) => void }) {
  const [form, setForm] = useState({ firstName: "", lastName: "", rut: "", specialty: "", extraTitles: "", clinicName: "", documentType: "rut" as ProfessionalDocumentType });
  const [original, setOriginal] = useState<typeof form | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(""), [saving, setSaving] = useState(false), [done, setDone] = useState("");
  const firstRef = useRef<HTMLInputElement | null>(null);
  const set = (key: keyof typeof form) => (value: string) => { setForm(current => ({ ...current, [key]: value })); setDone(""); };

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/profile", { cache: "no-store" });
        const data = await response.json() as { profile?: ClinicianProfile | null; error?: string };
        if (!response.ok) throw new Error(data.error || "No se pudo leer tu perfil.");
        const loaded = { firstName: data.profile?.firstName ?? "", lastName: data.profile?.lastName ?? "", rut: data.profile?.rut ?? "", specialty: data.profile?.specialty ?? "", extraTitles: data.profile?.extraTitles ?? "", clinicName: data.profile?.clinicName ?? "", documentType: professionalDocumentTypeOf(data.profile?.rut) };
        if (active) { setForm(loaded); setOriginal(loaded); setLoading(false); setTimeout(() => firstRef.current?.focus(), 0); }
      } catch (e) { if (active) { setError(e instanceof Error ? e.message : "No se pudo leer tu perfil."); setLoading(false); } }
    })();
    return () => { active = false; };
  }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") attemptClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const changed = Boolean(original) && (Object.keys(form) as Array<keyof typeof form>).some(key => form[key] !== original![key]);
  const attemptClose = () => { if (changed && !window.confirm("Hay cambios sin guardar. ¿Cerrar y descartarlos?")) return; onClose(); };

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const checked = checkProfile(form);
    if (!checked.ok) { setError(checked.error); return; }
    const before = original, after = checked.profile;
    const renamed = before && (before.firstName !== after.firstName || before.lastName !== after.lastName || before.rut !== after.rut);
    if (renamed && !window.confirm(`¿Guardar el cambio de nombre o documento?\n\nSe mostrará como ${displayName(after)}, documento ${after.rut}.`)) return;
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/profile", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const data = await response.json().catch(() => ({})) as { error?: string; profile?: ClinicianProfile };
      if (!response.ok || !data.profile) { setError(data.error || "No se pudo guardar. Inténtalo de nuevo."); return; }
      const saved = { firstName: data.profile.firstName, lastName: data.profile.lastName, rut: data.profile.rut, specialty: data.profile.specialty, extraTitles: data.profile.extraTitles ?? "", clinicName: data.profile.clinicName ?? "", documentType: professionalDocumentTypeOf(data.profile.rut) };
      setForm(saved); setOriginal(saved); setDone("Perfil actualizado.");
      onSaved(data.profile);
    } catch { setError("No se pudo conectar. Revisa tu conexión e inténtalo de nuevo."); }
    finally { setSaving(false); }
  }

  return <div role="dialog" aria-modal="true" aria-labelledby="perfil-titulo" className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#2a2540]/70 p-4 sm:items-center" data-testid="profile-dialog">
    <form onSubmit={submit} noValidate className="my-6 w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-wide text-[#473a6d]">Gestión Dental</p><h2 id="perfil-titulo" className="mt-1 text-2xl font-semibold text-[#35343f]">Mi perfil</h2></div>
        <button type="button" onClick={attemptClose} aria-label="Cerrar" className="rounded-lg p-2 text-[#57566a] hover:bg-[#f1f0f5]"><X className="size-5" /></button>
      </div>
      <div className="mt-3 rounded-lg border border-[#d2d4df] bg-[#f7f6fa] p-3 text-sm text-[#3b3355]">
        <p>Correo de ingreso: <strong className="break-all">{email}</strong></p>
        <p className="mt-1 text-xs text-[#615f73]">Tu ficha y tus pacientes están ligados a este correo. Puedes cambiar tus datos cuando quieras, pero para ver tu ficha siempre hay que ingresar con este correo.</p>
      </div>
      {loading ? <p className="mt-5 text-sm text-[#615f73]" role="status">Cargando tu perfil…</p> : <>
        <div className="mt-5 grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <label className="text-sm font-medium text-[#35343f]">Nombre<input ref={firstRef} className={field} autoComplete="given-name" value={form.firstName} onChange={e => set("firstName")(e.target.value)} /></label>
            <label className="text-sm font-medium text-[#35343f]">Apellido<input className={field} autoComplete="family-name" value={form.lastName} onChange={e => set("lastName")(e.target.value)} /></label>
          </div>
          <label className="text-sm font-medium text-[#35343f]">Tipo de documento
            <select className={field} value={form.documentType} onChange={(e) => setForm((c) => ({ ...c, documentType: e.target.value === "extranjero" ? "extranjero" : "rut", rut: formatDocument(c.rut, e.target.value === "extranjero" ? "extranjero" : "rut") }))} data-testid="professional-document-type">
              <option value="rut">RUT chileno</option>
              <option value="extranjero">Documento extranjero (DNI, cédula, DPI, pasaporte…)</option>
            </select>
          </label>
          <label className="text-sm font-medium text-[#35343f]">{form.documentType === "extranjero" ? "Número de documento" : "RUT"}<input className={field} inputMode="text" autoCapitalize="characters" autoComplete="off" placeholder={form.documentType === "extranjero" ? "Ej. 1-0234-0567, pasaporte…" : "12.345.678-5"} value={form.rut} onChange={e => set("rut")(e.target.value)} onBlur={() => set("rut")(formatDocument(form.rut, form.documentType))} data-testid="professional-document" /></label>
          <label className="text-sm font-medium text-[#35343f]">Especialidad principal
            <select className={field} value={form.specialty} onChange={e => set("specialty")(e.target.value)}>
              <option value="">Elige una opción</option>
              {SPECIALTIES.map(item => <option key={item} value={item}>{item}</option>)}
            </select>
            <span className="mt-1 block text-xs font-normal text-[#615f73]">Si obtuviste un nuevo título, cámbiala aquí o súmalo abajo.</span>
          </label>
          <label className="text-sm font-medium text-[#35343f]">Nombre de tu clínica o consulta <span className="font-normal text-[#6b6a7c]">(opcional)</span>
            <input className={field} maxLength={60} value={form.clinicName} onChange={e => set("clinicName")(e.target.value)} placeholder="Ej. Clínica Sonrisa Sur" data-testid="profile-clinic" />
            <span className="mt-1 block text-xs font-normal text-[#615f73]">Se muestra arriba en el menú y en tus presupuestos. Vacío = «Gestión Dental».</span>
          </label>
          <label className="text-sm font-medium text-[#35343f]">Otros títulos o especialidades <span className="font-normal text-[#6b6a7c]">(opcional)</span>
            <textarea className={field + " min-h-20 py-2"} rows={2} maxLength={300} value={form.extraTitles} onChange={e => set("extraTitles")(e.target.value)} placeholder="Ej. Diplomado en implantología; magíster en…" />
          </label>
        </div>
        <p className="mt-3 text-xs text-[#6b6a7c]">Se mostrará como {form.firstName.trim() && form.lastName.trim() ? displayName(form) : "Dr(a). Nombre Apellido"}.</p>
        {error && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
        {done && !error && <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{done}</p>}
        <div className="mt-5 flex gap-3">
          <button type="submit" disabled={saving || !changed} className="min-h-11 flex-1 rounded-lg bg-[#473a6d] px-4 text-base font-semibold text-white hover:bg-[#3a2f5a] disabled:opacity-50" data-testid="profile-save">{saving ? "Guardando…" : "Guardar cambios"}</button>
          <button type="button" onClick={attemptClose} className="min-h-11 rounded-lg border border-[#d2d4df] px-4 text-base font-medium text-[#57566a] hover:bg-[#f7f6fa]">Cerrar</button>
        </div>
      </>}
    </form>
  </div>;
}
