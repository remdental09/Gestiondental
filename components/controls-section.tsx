"use client";

import { lazy, Suspense, useState } from "react";
import { NextControlsPanel, type ControlStart } from "@/components/next-controls";
import { useSpaceRole } from "@/components/space-role";

const CallLists = lazy(() => import("@/components/call-lists").then(module => ({ default: module.CallLists })));

/** Sección «Controles»: los controles agendados y, al lado, «A quién llamar» (no disponible para la asistente: incluye montos). */
export function ControlsSection({ start, onOpenPatient, clinicName }: { start?: ControlStart | null; onOpenPatient: (patientId: number) => void; clinicName?: string }) {
  const role = useSpaceRole();
  const [view, setView] = useState<"controles" | "llamar">("controles");
  const canCall = role !== "asistente";
  const shown = canCall && !start ? view : "controles";
  return <div>
    {canCall && <div className="mb-3 inline-flex rounded-lg bg-[#efeef4] p-1" role="tablist" aria-label="Vista de controles">
      {([["controles", "Controles"], ["llamar", "A quién llamar"]] as const).map(([key, label]) =>
        <button key={key} type="button" role="tab" aria-selected={shown === key} onClick={() => setView(key)} data-testid={`controls-view-${key}`}
          className={"min-h-11 rounded-md px-4 text-sm font-semibold sm:min-h-9 " + (shown === key ? "bg-white shadow" : "text-[#615f73]")}>{label}</button>)}
    </div>}
    {shown === "llamar"
      ? <div className="surface"><Suspense fallback={<p role="status" className="text-sm text-[#6b6a7c]">Cargando…</p>}><CallLists onOpenPatient={onOpenPatient} /></Suspense></div>
      : <NextControlsPanel start={start} onOpenPatient={onOpenPatient} clinicName={clinicName} />}
  </div>;
}
