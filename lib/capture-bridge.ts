/**
 * Conexión de la ficha con la Capturadora SpeakDent, un programa de Windows que escucha solo en este
 * computador (tools/capturadora/Puente.cs). La imagen no pasa por ningún servidor intermedio: el navegador
 * la recibe del programa y la guarda en la ficha con la sesión ya iniciada.
 */
export const CAPTURE_URL = "http://127.0.0.1:47821";
export const CAPTURE_REMEMBER_KEY = "speakdent.capturadora";

/** Vistas que la capturadora sabe recortar o rotular; los identificadores son los de tools/capturadora/Puente.cs. */
export const CAPTURE_VIEWS = { "Transversal": "transversal", "Axial": "axial", "Panorámica": "panoramica", "Vista 3D": "vista3d", "Radiografía": "radiografia" } as const;
export type CaptureView = keyof typeof CAPTURE_VIEWS;
const viewFrom = (id: unknown) => (Object.keys(CAPTURE_VIEWS) as CaptureView[]).find(name => CAPTURE_VIEWS[name] === id) ?? null;
/** Lo que la ficha quiere recibir: el tipo elegido y si va solo el recuadro marcado o la ventana completa. */
export type CaptureChoice = { view: CaptureView; wholeWindow: boolean };

export type CaptureStatus = {
  viewer: string | null; hotkey: string | null; version: string | null;
  /** Título de la ventana del visor (puede traer el nombre del paciente); solo en memoria. */
  title: string | null;
  /** Vistas con recuadro marcado. null: capturadora anterior, que no las maneja. */
  marked: CaptureView[] | null;
};
export type PendingCapture = { id: string; viewer: string | null; view: CaptureView | null; title: string | null; warning: string | null };
/**
 * ¿Hay que ubicar las vistas en el navegador? Sí, cuando llega la ventana completa de Blue Sky Plan y se quiere
 * un corte: lo que ya viene recortado por una marca de la capturadora, o la ventana pedida entera, se deja igual.
 */
export function needsCut(options: { viewer: string | null; view: CaptureView; marked: CaptureView[] | null; wholeWindow: boolean; all: boolean }): boolean {
  if (!/^blue ?sky ?plan/i.test(options.viewer ?? "")) return false;
  if (options.all) return true;
  return !options.wholeWindow && options.view !== "Radiografía" && !options.marked?.includes(options.view);
}

export type CaptureState =
  | { kind: "receiving"; status: CaptureStatus }
  /** Otra ficha (otra pestaña) tomó el turno. */
  | { kind: "other" }
  /** No responde: está cerrada, es la versión anterior o el navegador no dio permiso. */
  | { kind: "missing" };

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export type CaptureOptions = {
  /**
   * Recibe la imagen. «saved»: quedó en la ficha; «held»: la ficha la retiene para preguntar;
   * «busy»: se está guardando otra, reintentar; «failed»: no se pudo.
   */
  save: (file: File, capture: PendingCapture) => Promise<"saved" | "held" | "busy" | "failed">;
  onState: (state: CaptureState) => void;
  onProblem: (message: string) => void;
  session?: string;
  fetcher?: Fetch;
  wait?: (ms: number) => Promise<void>;
};

const text = (value: unknown, max = 80) => typeof value === "string" && value ? value.slice(0, max) : null;

const PARTICLES = new Set(["DE", "DEL", "LA", "LAS", "LOS", "DA", "DO", "VON", "VAN"]);
/** Partes de un nombre comparables entre sí: sin tildes, en mayúsculas y sin letras repetidas (errores de digitación). */
const nameParts = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase()
  .split(/[^A-Z]+/).filter(part => part.length > 1 && !PARTICLES.has(part)).map(part => part.replace(/(.)\1+/g, "$1"));

/** El nombre que muestra Blue Sky Plan en su barra: «Blue Sky Plan - NOMBRE - C:/carpeta». */
export function viewerPatient(title: string | null): string | null {
  const parts = (title ?? "").split(" - ").map(part => part.trim());
  if (!/^blue ?sky ?plan/i.test(parts[0] ?? "")) return null;
  const name = parts[1] ?? "";
  return name && !/[\\/]|^[A-Za-z]:|\.[A-Za-z0-9]{2,5}$/.test(name) && nameParts(name).length ? name : null;
}

/**
 * ¿El estudio abierto es del paciente de la ficha?
 * «distinto»: Blue Sky muestra un nombre y no calza; «sin-dato»: no se puede saber.
 * Calza solo si comparten dos partes o más y una de las dos listas está completa dentro de la otra,
 * así un hermano con los mismos apellidos no pasa.
 */
export function patientCheck(title: string | null, patientName: string): "coincide" | "distinto" | "sin-dato" {
  const record = nameParts(patientName), shown = viewerPatient(title);
  if (!record.length) return "sin-dato";
  if (shown === null) {
    const all = nameParts(title ?? "");
    return record.length > 1 && record.every(part => all.includes(part)) ? "coincide" : "sin-dato";
  }
  const viewer = nameParts(shown);
  const common = new Set(viewer.filter(part => record.includes(part))).size;
  return common >= 2 && (viewer.every(part => record.includes(part)) || record.every(part => viewer.includes(part))) ? "coincide" : "distinto";
}

export function readStatus(data: unknown): (CaptureStatus & { active: boolean; captures: PendingCapture[] }) | null {
  if (!data || typeof data !== "object") return null;
  const value = data as Record<string, unknown>;
  if (value.app !== "capturadora-speakdent") return null;
  const captures = Array.isArray(value.capturas) ? value.capturas.flatMap(item => {
    const row = item as { id?: unknown; visor?: unknown; vista?: unknown; titulo?: unknown; aviso?: unknown } | null;
    return row && typeof row.id === "string" && /^[0-9a-f]{32}$/.test(row.id)
      ? [{ id: row.id, viewer: text(row.visor), view: viewFrom(row.vista), title: text(row.titulo, 300), warning: text(row.aviso, 200) }] : [];
  }) : [];
  const marked = Array.isArray(value.marcadas) ? value.marcadas.flatMap(id => viewFrom(id) ?? []) : null;
  return { viewer: text(value.visor), hotkey: text(value.tecla), version: text(value.version), title: text(value.titulo, 300), marked, active: value.activa !== false, captures };
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
  let choice: CaptureChoice | null = null;
  const preferences = () => choice ? `&vista=${CAPTURE_VIEWS[choice.view]}&encuadre=${choice.wholeWindow ? "completo" : "marcado"}` : "";

  const request = async (path: string, method: "GET" | "POST", extra = "", timeout = 30_000) => {
    const url = `${CAPTURE_URL}${path}?sesion=${session}${extra}`;
    const response = await fetcher(url, { method, cache: "no-store", credentials: "omit", signal: AbortSignal.any([abort.signal, AbortSignal.timeout(timeout)]) });
    if (!response.ok) throw new Error(`capturadora ${response.status}`);
    return response;
  };

  const receive = async (capture: PendingCapture) => {
    if (done.has(capture.id)) { await request("/recibida", "POST", `&id=${capture.id}`); return; }
    // Si se volvió a tomar el turno mientras se guardaba, la misma captura no se guarda dos veces.
    if (saving.has(capture.id)) { await wait(700); return; }
    saving.add(capture.id);
    try {
      const blob = await (await request("/imagen", "GET", `&id=${capture.id}`)).blob();
      if (stopped) return;
      const result = await options.save(new File([blob], "captura.png", { type: "image/png" }), capture);
      if (result === "busy") { await wait(700); return; }
      done.add(capture.id);
      if (result === "failed") options.onProblem("La captura no se pudo guardar en la ficha. Quedó en la carpeta Imágenes\\SpeakDent del computador: súbela desde ahí.");
      await request("/recibida", "POST", `&id=${capture.id}`);
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
        const data = readStatus(await (await request("/escuchar", "POST", preferences(), 60_000)).json());
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
    /** Cambia el tipo elegido: la capturadora lo usa para lo que se capture con F8. */
    async choose(next: CaptureChoice): Promise<void> {
      choice = next;
      if (stopped || !turn) return;
      // Una capturadora anterior no conoce esta orden: se sigue igual, sin recortes por vista.
      await request("/ajustar", "POST", preferences()).catch(() => undefined);
    },
    /** Pide la captura ahora (o una de cada vista marcada); las imágenes llegan por la misma escucha. */
    async capture(all = false): Promise<boolean> {
      try {
        if (choice) await request("/ajustar", "POST", preferences()).catch(() => undefined);
        const answer = await (await request("/capturar", "POST", all ? "&todas=1" : "", 25_000)).json() as { ok?: boolean; error?: unknown };
        if (!answer.ok && !stopped) options.onProblem(text(answer.error) ?? "No se pudo capturar.");
        return answer.ok === true;
      } catch { if (!stopped) options.onProblem("La capturadora no respondió. Comprueba que esté abierta."); return false; }
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
