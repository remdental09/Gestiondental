"use client";
import { useEffect, useRef, useState } from "react";
import { Building2, X } from "lucide-react";
import { EMPTY_CLINIC, LOGO_MAX_SIDE, checkClinic, formatPhone, type ClinicProfile } from "@/lib/clinic-profile";

const field = "mt-1 block min-h-11 w-full rounded-lg border border-[#d2d4df] bg-white px-3 text-base text-[#35343f] focus-visible:outline-2 focus-visible:outline-[#473a6d]";
const label = "text-sm font-medium text-[#35343f]";

/** Reduce la imagen elegida a 200x200 px como máximo y la devuelve como data URL. */
async function shrinkImage(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error("Usa una imagen PNG, JPG o WebP.");
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, LOGO_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL(file.type === "image/jpeg" ? "image/jpeg" : "image/png", 0.9);
}

/** «Perfil de la clínica»: imagen, nombre, contacto y horario de atención. */
export function ClinicDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (clinic: ClinicProfile) => void }) {
  const [form, setForm] = useState<ClinicProfile>(EMPTY_CLINIC);
  const [original, setOriginal] = useState<ClinicProfile | null>(null);
  const [loading, setLoading] = useState(true), [saving, setSaving] = useState(false);
  const [error, setError] = useState(""), [done, setDone] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);
  const set = (key: keyof ClinicProfile) => (value: string) => { setForm(c => ({ ...c, [key]: value })); setDone(""); };

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/clinica", { cache: "no-store" });
        const data = await response.json() as { clinic?: ClinicProfile; error?: string };
        if (!response.ok || !data.clinic) throw new Error(data.error || "No se pudo leer el perfil de la clínica.");
        if (active) { setForm(data.clinic); setOriginal(data.clinic); setLoading(false); }
      } catch (e) { if (active) { setError(e instanceof Error ? e.message : "No se pudo leer el perfil de la clínica."); setLoading(false); } }
    })();
    return () => { active = false; };
  }, []);

  const changed = Boolean(original) && (Object.keys(form) as Array<keyof ClinicProfile>).some(key => form[key] !== original![key]);
  const attemptClose = () => { if (changed && !window.confirm("Hay cambios sin guardar. ¿Cerrar y descartarlos?")) return; onClose(); };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") attemptClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  async function pickImage(file: File | undefined) {
    if (!file) return;
    try { set("logo")(await shrinkImage(file)); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "No se pudo leer la imagen."); }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const checked = checkClinic(form);
    if (!checked.ok) { setError(checked.error); return; }
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/clinica", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const data = await response.json().catch(() => ({})) as { error?: string; clinic?: ClinicProfile };
      if (!response.ok || !data.clinic) { setError(data.error || "No se pudo guardar. Inténtalo de nuevo."); return; }
      setForm(data.clinic); setOriginal(data.clinic); setDone("Perfil de la clínica actualizado.");
      onSaved(data.clinic);
    } catch { setError("No se pudo conectar. Revisa tu conexión e inténtalo de nuevo."); }
    finally { setSaving(false); }
  }

  return <div role="dialog" aria-modal="true" aria-labelledby="clinica-titulo" className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-[#2a2540]/70 p-4 sm:items-center" data-testid="clinic-dialog">
    <form onSubmit={submit} noValidate className="my-6 w-full max-w-lg rounded-xl bg-white p-6 shadow-xl">
      <div className="flex items-start justify-between gap-3">
        <div><p className="text-xs font-bold uppercase tracking-wide text-[#473a6d]">Gestión Dental</p><h2 id="clinica-titulo" className="mt-1 text-2xl font-semibold text-[#35343f]">Perfil de la clínica</h2></div>
        <button type="button" onClick={attemptClose} aria-label="Cerrar" className="rounded-lg p-2 text-[#57566a] hover:bg-[#f1f0f5]"><X className="size-5" /></button>
      </div>
      {loading ? <p className="mt-5 text-sm text-[#615f73]" role="status">Cargando…</p> : <>
        <div className="mt-5 flex items-center gap-4 rounded-lg border border-[#d2d4df] bg-[#f7f6fa] p-4">
          <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-[#d2d4df] bg-white text-[#473a6d]">
            {form.logo ? <img src={form.logo} alt="Imagen de la clínica" className="size-full object-contain" /> : <Building2 className="size-8" aria-hidden="true" />}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-[#35343f]">Imagen de la clínica</p>
            <p className="text-xs text-[#615f73]">Tamaño máximo: {LOGO_MAX_SIDE}x{LOGO_MAX_SIDE} px. Si es más grande, se reduce sola.</p>
            <div className="mt-2 flex gap-2">
              <button type="button" onClick={() => fileRef.current?.click()} className="min-h-9 rounded-lg border border-[#473a6d] px-3 text-sm font-semibold text-[#473a6d] hover:bg-[#ece8f6]" data-testid="clinic-logo-pick">{form.logo ? "Cambiar imagen" : "Subir imagen"}</button>
              {form.logo && <button type="button" onClick={() => set("logo")("")} className="min-h-9 rounded-lg px-3 text-sm font-medium text-[#57566a] hover:bg-[#f1f0f5]">Quitar</button>}
            </div>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={e => { void pickImage(e.target.files?.[0]); e.target.value = ""; }} />
          </div>
        </div>
        <div className="mt-4 grid gap-4">
          <label className={label}>Nombre de la clínica<input className={field} maxLength={60} value={form.clinicName} onChange={e => set("clinicName")(e.target.value)} placeholder="Ej. Clínica Sonrisa Sur" data-testid="clinic-field-name" /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={label}>Dirección<input className={field} maxLength={120} autoComplete="street-address" value={form.address} onChange={e => set("address")(e.target.value)} placeholder="Calle y número" /></label>
            <label className={label}>Ciudad<input className={field} maxLength={60} value={form.city} onChange={e => set("city")(e.target.value)} placeholder="Ej. Temuco" /></label>
          </div>
          <label className={label}>Email de contacto<input className={field} type="email" inputMode="email" maxLength={120} value={form.email} onChange={e => set("email")(e.target.value)} placeholder="contacto@clinica.cl" /></label>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={label}>Teléfono principal<input className={field} type="tel" inputMode="tel" value={form.phone} onChange={e => set("phone")(e.target.value)} onBlur={() => set("phone")(formatPhone(form.phone))} placeholder="+56 9 1234 5678" /></label>
            <label className={label}>Teléfono secundario<input className={field} type="tel" inputMode="tel" value={form.phone2} onChange={e => set("phone2")(e.target.value)} onBlur={() => set("phone2")(formatPhone(form.phone2))} placeholder="+56 9 1234 5678" /></label>
          </div>
          <fieldset>
            <legend className="text-sm font-semibold text-[#35343f]">Horarios de atención</legend>
            <div className="mt-1 grid gap-3 sm:grid-cols-2">
              <label className={label}>Hora de apertura<input className={field} type="time" value={form.openTime} onChange={e => set("openTime")(e.target.value)} data-testid="clinic-open" /></label>
              <label className={label}>Hora de cierre<input className={field} type="time" value={form.closeTime} onChange={e => set("closeTime")(e.target.value)} data-testid="clinic-close" /></label>
            </div>
          </fieldset>
        </div>
        {error && <p role="alert" className="mt-4 rounded-lg bg-rose-50 p-3 text-sm text-rose-800">{error}</p>}
        {done && !error && <p role="status" className="mt-4 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{done}</p>}
        <div className="mt-5 flex gap-3">
          <button type="submit" disabled={saving || !changed} className="min-h-11 flex-1 rounded-lg bg-[#473a6d] px-4 text-base font-semibold text-white hover:bg-[#3a2f5a] disabled:opacity-50" data-testid="clinic-save">{saving ? "Guardando…" : "Guardar cambios"}</button>
          <button type="button" onClick={attemptClose} className="min-h-11 rounded-lg border border-[#d2d4df] px-4 text-base font-medium text-[#57566a] hover:bg-[#f7f6fa]">Cerrar</button>
        </div>
      </>}
    </form>
  </div>;
}
