"use client";
import { lazy, Suspense, type ComponentProps } from "react";

const ClinicalVoiceAssistant = lazy(() => import("./clinical-voice-assistant").then(module => ({ default: module.ClinicalVoiceAssistant })));

export function DeferredClinicalVoiceAssistant(props: ComponentProps<typeof ClinicalVoiceAssistant>) {
  return <Suspense fallback={<div className="p-4 text-sm text-[#71858b]" role="status">Cargando asistente de voz…</div>}>
    <ClinicalVoiceAssistant {...props}/>
  </Suspense>;
}
