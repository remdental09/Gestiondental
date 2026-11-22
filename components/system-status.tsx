"use client";

import { useEffect, useState } from "react";

type Estado = {
  tareas: { ultima: string | null; fallando: { tarea: string; desde: string | null; detalle?: string | null }[] };
  ia: { llamadas: number; tokens: number; audioMinutos: number; limites: { llamadas: number; tokens: number; audioMinutos: number } };
};

const hora = (iso: string | null) => iso ? new Intl.DateTimeFormat("es-CL", { dateStyle: "short", timeStyle: "short", timeZone: "America/Santiago" }).format(new Date(iso)) : "—";

/** Línea de estado en Configuración: tareas automáticas y uso de IA de hoy. */
export function SystemStatus() {
  const [estado, setEstado] = useState<Estado | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/estado", { cache: "no-store" }).then(async (response) => { if (alive && response.ok) setEstado(await response.json() as Estado); }).catch(() => {});
    return () => { alive = false; };
  }, []);
  if (!estado) return null;
  const { tareas, ia } = estado;
  const fallando = tareas.fallando.length > 0;
  const pct = Math.min(100, Math.round(100 * Math.max(ia.llamadas / ia.limites.llamadas, ia.tokens / ia.limites.tokens)));
  return (
    <section className="surface space-y-1 text-sm" aria-label="Estado del sistema" data-testid="estado-sistema">
      <p className={fallando ? "font-medium text-amber-800" : "text-[#4b4a5c]"}>
        {fallando
          ? <>Tareas automáticas con errores: {tareas.fallando.map((item) => `${item.tarea} (desde ${hora(item.desde)})`).join(", ")}. Si la agenda no se actualiza, reconecta Google en esta pantalla.</>
          : <>Tareas automáticas al día · última revisión {hora(tareas.ultima)}.</>}
      </p>
      {tareas.fallando.some((item) => item.detalle) && <p className="break-words text-xs text-[#6b6a7c]">{tareas.fallando.filter((item) => item.detalle).map((item) => `${item.tarea}: ${item.detalle}`).join(" · ")}</p>}
      <p className={pct >= 90 ? "text-amber-800" : "text-[#6b6a7c]"}>IA hoy: {ia.llamadas} de {ia.limites.llamadas} consultas{ia.audioMinutos ? ` · ${ia.audioMinutos} min de audio` : ""} ({pct}% del tope diario).</p>
    </section>
  );
}
