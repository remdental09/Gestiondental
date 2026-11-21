"use client";

import { useState } from "react";
import { CONSENT_SPECIALTIES, consentTemplatesOf, consentTemplateContent, type ConsentTemplate } from "@/lib/consent-templates";

/** Elige una especialidad y un procedimiento para rellenar el consentimiento. Todo queda editable antes de guardar. */
export function ConsentTemplatePicker({ onPick }: { onPick: (content: ReturnType<typeof consentTemplateContent>, template: ConsentTemplate) => void }) {
  const [specialty, setSpecialty] = useState("");
  const [pickedId, setPickedId] = useState("");
  const templates = specialty ? consentTemplatesOf(specialty) : [];
  return <section className="mt-4 rounded-xl border border-[#e6e4ee] bg-[#faf9fc] p-3" data-testid="consent-templates">
    <h3 className="text-sm font-semibold text-[#35343f]">Parte desde una plantilla (opcional)</h3>
    <p className="mt-0.5 text-xs text-[#615f73]">Elige la especialidad y el procedimiento: se llenan los campos y los puedes editar a tu gusto antes de guardar.</p>
    <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Especialidad">
      {CONSENT_SPECIALTIES.map(item => <button key={item} type="button" aria-pressed={specialty === item} onClick={() => { setSpecialty(item); setPickedId(""); }}
        className={`min-h-10 rounded-full border px-3 text-sm font-semibold ${specialty === item ? "border-[#473a6d] bg-[#473a6d] text-white" : "border-[#b9b1ce] bg-white text-[#473a6d] hover:bg-[#f3f1f7]"}`}>{item}</button>)}
    </div>
    {templates.length > 0 && <ul className="mt-3 space-y-2" aria-label="Procedimientos">
      {templates.map(template => <li key={template.id}>
        <button type="button" data-testid={`consent-template-${template.id}`} onClick={() => { setPickedId(template.id); onPick(consentTemplateContent(template), template); }}
          className={`min-h-11 w-full rounded-lg border px-3 py-2 text-left text-sm ${pickedId === template.id ? "border-[#473a6d] bg-[#ece8f7] font-semibold" : "border-[#e0def0] bg-white hover:bg-[#f3f1f7]"}`}>{template.procedure}</button>
      </li>)}
    </ul>}
  </section>;
}
