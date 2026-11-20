"use client";

import { useEffect, useState } from "react";
import { DEFAULT_TITLE, PROFESSIONAL_TITLES, asProfessionalTitle, type ProfessionalTitle } from "@/lib/clinician-profile";

const LABEL: Record<ProfessionalTitle, string> = { "Dr.": "Dr.", "Dra.": "Dra.", "Dr(a).": "Dr(a). (sin especificar)" };

/** Selector de tratamiento: «Dr.», «Dra.» o «Dr(a).». */
export function TitleSelect({ value, onChange, className, testId = "professional-title" }: { value: string; onChange: (title: ProfessionalTitle) => void; className: string; testId?: string }) {
  return <select className={className} value={asProfessionalTitle(value)} onChange={event => onChange(asProfessionalTitle(event.target.value))} data-testid={testId}>
    {PROFESSIONAL_TITLES.map(title => <option key={title} value={title}>{LABEL[title]}</option>)}
  </select>;
}

/** En Configuración → Profesionales: cada dentista elige su propio tratamiento (se guarda al cambiarlo). */
export function ProfessionalTitleSetting() {
  const [title, setTitle] = useState<ProfessionalTitle>(DEFAULT_TITLE);
  const [name, setName] = useState("");
  const [state, setState] = useState<"cargando" | "listo" | "sin-perfil" | "guardando" | "guardado" | "error">("cargando");
  useEffect(() => {
    let active = true;
    void fetch("/api/profile", { cache: "no-store" }).then(response => response.json() as Promise<{ profile?: { title?: string; firstName?: string; lastName?: string } | null }>).then(data => {
      if (!active) return;
      if (!data.profile) { setState("sin-perfil"); return; }
      setTitle(asProfessionalTitle(data.profile.title)); setName(`${data.profile.firstName ?? ""} ${data.profile.lastName ?? ""}`.trim()); setState("listo");
    }).catch(() => { if (active) setState("error"); });
    return () => { active = false; };
  }, []);
  const change = async (next: ProfessionalTitle) => {
    const previous = title;
    setTitle(next); setState("guardando");
    try {
      const response = await fetch("/api/profile", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: next }) });
      if (!response.ok) throw new Error();
      setState("guardado");
    } catch { setTitle(previous); setState("error"); }
  };
  if (state === "cargando" || state === "sin-perfil") return null;
  return <div className="flex flex-wrap items-end gap-3" data-testid="professional-title-setting">
    <label className="text-sm font-medium text-[#35343f]">Título en tus documentos
      <TitleSelect className="mt-1 block min-h-11 rounded-lg border border-[#d2d4df] bg-white px-3 text-base text-[#35343f]" value={title} onChange={next => void change(next)}/>
    </label>
    <p className="pb-2 text-sm text-[#615f73]" role="status">{state === "guardando" ? "Guardando…" : state === "error" ? "No se pudo guardar. Inténtalo de nuevo." : <>Se mostrará como <strong>{title} {name}</strong>{state === "guardado" ? " · guardado" : ""}</>}</p>
  </div>;
}
