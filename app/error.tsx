"use client";

import { useEffect } from "react";

/** Si algo falla al dibujar la pantalla, no se cierra la aplicación: se ofrece volver a intentar y se reintenta sola una vez. */
export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("Error de pantalla:", error);
    let retried = false;
    try { retried = sessionStorage.getItem("gd-error-retry") === "1"; sessionStorage.setItem("gd-error-retry", "1"); } catch { /* sin almacenamiento */ }
    if (retried) return;
    const timer = setTimeout(() => reset(), 1500);
    const clear = setTimeout(() => { try { sessionStorage.removeItem("gd-error-retry"); } catch { /* nada */ } }, 60000);
    return () => { clearTimeout(timer); clearTimeout(clear); };
  }, [error, reset]);

  return <main className="mx-auto max-w-md p-8 text-center" role="alert">
    <h1 className="text-xl font-semibold">Algo falló en esta pantalla</h1>
    <p className="mt-2 text-sm text-[#615f73]">Tus fichas están a salvo. Pulsa «Reintentar»; si la sesión venció, «Volver a entrar».</p>
    <div className="mt-5 flex justify-center gap-3">
      <button type="button" onClick={() => reset()} className="h-10 rounded-lg bg-[#473a6d] px-4 text-sm font-semibold text-white">Reintentar</button>
      <button type="button" onClick={() => location.reload()} className="h-10 rounded-lg border border-[#cfcde0] px-4 text-sm font-semibold">Volver a entrar</button>
    </div>
  </main>;
}
