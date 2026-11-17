"use client";

import { useEffect, useState } from "react";
import { Eye, FileText, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { BudgetFormatEditor } from "@/components/budget-format-editor";
import { DEFAULT_FORMAT, checkBudgetFormat, type BudgetClinicData, type BudgetFormat } from "@/lib/budget-format";

/** Configuración → «Mi presupuesto»: cómo se ve el PDF que arma este profesional. Vista previa con datos de ejemplo. */
export function BudgetFormatPanel() {
  const [format, setFormat] = useState<BudgetFormat | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [logo, setLogo] = useState({ has: false, embeddable: false });
  const [profileClinic, setProfileClinic] = useState<BudgetClinicData | null>(null);
  const [busy, setBusy] = useState<"" | "guardar" | "vista">("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    let live = true;
    fetch("/api/presupuesto/formato").then(r => r.ok ? r.json() as Promise<{ format: BudgetFormat; hasLogo: boolean; logoEmbeddable: boolean; profileClinic?: BudgetClinicData | null }> : null)
      .then(data => { if (!live) return; if (!data) setLoadFailed(true); setFormat(data?.format ?? { ...DEFAULT_FORMAT }); if (data) { setLogo({ has: data.hasLogo, embeddable: data.logoEmbeddable }); setProfileClinic(data.profileClinic ?? null); } })
      .catch(() => { if (live) { setLoadFailed(true); setFormat({ ...DEFAULT_FORMAT }); } });
    return () => { live = false; };
  }, []);

  if (!format) return <section className="surface text-sm text-[#6b6a7c]" role="status">Cargando formato del presupuesto…</section>;

  async function send(action: "guardar" | "vista") {
    if (action === "guardar" && loadFailed) { setMessage({ ok: false, text: "No se pudo cargar tu formato guardado; recarga la página antes de guardar para no pisarlo." }); return; }
    const checked = checkBudgetFormat(format);
    if (!checked.ok) { setMessage({ ok: false, text: checked.error }); return; }
    // La pestaña se abre antes de esperar al servidor: así el navegador no la bloquea como ventana emergente.
    const preview = action === "vista" ? window.open("", "_blank") : null;
    setBusy(action); setMessage(null);
    try {
      const response = await fetch("/api/presupuesto/formato", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, format: checked.format }) });
      if (!response.ok) { const data = await response.json().catch(() => ({})) as { error?: string }; throw new Error(data.error || "No se pudo completar."); }
      if (action === "vista") {
        const url = URL.createObjectURL(await response.blob());
        if (preview) preview.location.href = url; else window.open(url, "_blank");
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } else {
        const saved = await response.json().catch(() => null) as { format?: BudgetFormat } | null;
        if (saved?.format) setFormat(saved.format);
        setMessage({ ok: true, text: "Formato guardado. Tus próximos presupuestos en PDF saldrán así." });
      }
    } catch (error) {
      preview?.close();
      setMessage({ ok: false, text: error instanceof Error ? error.message : "No se pudo completar." });
    } finally { setBusy(""); }
  }

  return <section className="surface space-y-5" aria-labelledby="formato-presupuesto" data-testid="budget-format-panel">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id="formato-presupuesto" className="flex items-center gap-2 font-semibold"><FileText className="size-4 text-[#473a6d]"/>Mi presupuesto (PDF)</h2>
        <p className="text-sm text-[#6b6a7c]">Cómo se ve el PDF de los presupuestos que armas. En una clínica, cada colega usa el suyo.</p>
      </div>
      <div className="flex gap-2">
        <Button type="button" variant="outline" disabled={Boolean(busy)} onClick={() => void send("vista")} data-testid="format-preview"><Eye className="mr-2 size-4"/>{busy === "vista" ? "Generando…" : "Vista previa"}</Button>
        <Button type="button" disabled={Boolean(busy)} onClick={() => void send("guardar")} className="bg-[#473a6d] text-white hover:bg-[#3a2f5a]" data-testid="format-save"><Save className="mr-2 size-4"/>{busy === "guardar" ? "Guardando…" : "Guardar"}</Button>
      </div>
    </div>

    <BudgetFormatEditor format={format} onChange={next => { setFormat(next); setMessage(null); }} logo={logo} profileClinic={profileClinic}/>

    {message && <p role={message.ok ? "status" : "alert"} className={"rounded-lg p-3 text-sm " + (message.ok ? "bg-emerald-50 text-emerald-900" : "bg-rose-50 text-rose-800")}>{message.text}</p>}
  </section>;
}
