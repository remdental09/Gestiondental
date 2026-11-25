/**
 * Conexión de la ficha con la Capturadora SpeakDent, un programa de Windows que escucha solo en este
 * computador (tools/capturadora/Puente.cs). La imagen no pasa por ningún servidor intermedio: el navegador
 * la recibe del programa y la guarda en la ficha con la sesión ya iniciada.
 */
export const CAPTURE_URL = "http://127.0.0.1:47821";
export const CAPTURE_REMEMBER_KEY = "speakdent.capturadora";

export type CaptureStatus = { viewer: string | null; hotkey: string | null };
export type PendingCapture = { id: string; viewer: string | null };
export type CaptureState =
  | { kind: "receiving"; status: CaptureStatus }
  /** Otra ficha (otra pestaña) tomó el turno. */
  | { kind: "other" }
  /** No responde: está cerrada, es la versión anterior o el navegador no dio permiso. */
  | { kind: "missing" };

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export type CaptureOptions = {
  /** Guarda la imagen en la ficha. «busy»: se está guardando otra, reintentar; «failed»: no se pudo. */
  save: (file: File) => Promise<"saved" | "busy" | "failed">;
  onState: (state: CaptureState) => void;
  onProblem: (message: string) => void;
  session?: string;
  fetcher?: Fetch;
  wait?: (ms: number) => Promise<void>;
};

const text = (value: unknown) => typeof value === "string" && value ? value.slice(0, 80) : null;

export function readStatus(data: unknown): (CaptureStatus & { active: boolean; captures: PendingCapture[] }) | null {
  if (!data || typeof data !== "object") return null;
  const value = data as Record<string, unknown>;
  if (value.app !== "capturadora-speakdent") return null;
  const captures = Array.isArray(value.capturas) ? value.capturas.flatMap(item => {
    const row = item as { id?: unknown; visor?: unknown } | null;
    return row && typeof row.id === "string" && /^[0-9a-f]{32}$/.test(row.id) ? [{ id: row.id, viewer: text(row.visor) }] : [];
  }) : [];
  return { viewer: text(value.visor), hotkey: text(value.tecla), active: value.activa !== false, captures };
}

export function newCaptureSession(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return [...bytes].map(byte => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Una sesión por ficha de implante abierta: lo capturado mientras escucha entra a esa ficha y a ninguna otra.
 * Al cerrar la ficha, `stop()` suelta el turno y descarta lo que no se alcanzó a recibir.
 */
export function createCaptureLink(options: CaptureOptions) {
  const session = options.session ?? newCaptureSession();
  const fetcher: Fetch = options.fetcher ?? ((url, init) => fetch(url, init));
  const wait = options.wait ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  const done = new Set<string>(), saving = new Set<string>();
  const abort = new AbortController();
  let stopped = false, turn = 0;

  const request = async (path: string, method: "GET" | "POST", id = "", timeout = 30_000) => {
    const url = `${CAPTURE_URL}${path}?sesion=${session}${id ? `&id=${id}` : ""}`;
    const response = await fetcher(url, { method, cache: "no-store", credentials: "omit", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(timeout)]) });
    if (!response.ok) throw new Error(`capturadora ${response.status}`);
    return response;
  };

  const receive = async (capture: PendingCapture) => {
    if (done.has(capture.id)) { await request("/recibida", "POST", capture.id); return; }
    // Si se volvió a tomar el turno mientras se guardaba, la misma captura no se guarda dos veces.
    if (saving.has(capture.id)) { await wait(700); return; }
    saving.add(capture.id);
    try {
      const blob = await (await request("/imagen", "GET", capture.id)).blob();
      if (stopped) return;
      const result = await options.save(new File([blob], "captura.png", { type: "image/png" }));
      if (result === "busy") { await wait(700); return; }
      done.add(capture.id);
      if (result === "failed") options.onProblem("La captura no se pudo guardar en la ficha. Quedó en la carpeta Imágenes\\SpeakDent del computador: súbela desde ahí.");
      await request("/recibida", "POST", capture.id);
    } finally { saving.delete(capture.id); }
  };

  const listen = async (own: number) => {
    const current = () => !stopped && own === turn;
    while (current()) {
      try {
        const data = readStatus(await (await request("/esperar", "GET")).json());
        if (!data) throw new Error("respuesta desconocida");
        if (!current()) return;
        for (const capture of data.captures) { if (stopped) return; await receive(capture); }
        if (!current()) return;
        if (!data.active) { options.onState({ kind: "other" }); return; }
        options.onState({ kind: "receiving", status: data });
      } catch {
        if (!current()) return;
        options.onState({ kind: "missing" });
        return;
      }
    }
  };

  return {
    session,
    /** Toma el turno (también sirve para reintentar o recuperarlo desde otra pestaña). */
    async connect(): Promise<boolean> {
      if (stopped) return false;
      const own = ++turn;
      try {
        // El primer intento espera más: el navegador puede estar mostrando su pregunta de permiso.
        const data = readStatus(await (await request("/escuchar", "POST", "", 60_000)).json());
        if (!data) throw new Error("respuesta desconocida");
        if (stopped || own !== turn) return false;
        options.onState({ kind: "receiving", status: data });
        void listen(own);
        return true;
      } catch {
        if (!stopped && own === turn) options.onState({ kind: "missing" });
        return false;
      }
    },
    /** Pide la captura ahora; la imagen llega por la misma escucha. */
    async capture(): Promise<void> {
      try {
        const answer = await (await request("/capturar", "POST", "", 25_000)).json() as { ok?: boolean; error?: unknown };
        if (!answer.ok && !stopped) options.onProblem(text(answer.error) ?? "No se pudo capturar.");
      } catch { if (!stopped) options.onProblem("La capturadora no respondió. Comprueba que esté abierta."); }
    },
    stop(): void {
      if (stopped) return;
      stopped = true;
      abort.abort();
      // keepalive: también llega si se está cerrando la pestaña.
      void fetcher(`${CAPTURE_URL}/soltar?sesion=${session}`, { method: "POST", credentials: "omit", keepalive: true }).catch(() => undefined);
    },
  };
}
