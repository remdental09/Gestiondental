"use client";

/** Último recurso si falla hasta el diseño general: la página no queda en blanco. */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <html lang="es-CL"><body style={{ fontFamily: "sans-serif", textAlign: "center", padding: "2rem" }}>
    <h1>La aplicación se detuvo un momento</h1>
    <p>Tus fichas están a salvo.</p>
    <button type="button" onClick={() => reset()} style={{ padding: "0.6rem 1rem", marginRight: "0.5rem" }}>Reintentar</button>
    <button type="button" onClick={() => location.reload()} style={{ padding: "0.6rem 1rem" }}>Volver a entrar</button>
  </body></html>;
}
