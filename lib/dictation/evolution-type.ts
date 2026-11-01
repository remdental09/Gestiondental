// Tipo de evolución dictada (control, obturación, higiene, implante, ortodoncia…).
// Puro y sin dependencias: lo usan las reglas, la mezcla con la IA, el cliente y los tests.
// El tipo decide el título de la nota y si se espera un cambio en el odontograma:
// un control no vuelve a marcar lo que ya está registrado.

export type EvolutionType =
  | "urgencia"
  | "implante-instalacion"
  | "implante-rehabilitacion"
  | "implante-control"
  | "endodoncia"
  | "exodoncia"
  | "obturacion"
  | "protesis"
  | "ortodoncia"
  | "higiene"
  | "pulido"
  | "preventivo"
  | "control"
  | "evaluacion"
  | "atencion";

export type EvolutionKind = {
  type: EvolutionType;
  /** Nombre corto del tipo, para la revisión («Control de implante»). */
  label: string;
  /** Título de la nota («Control de implante · FDI 3.6»). */
  title: string;
  /** Detalle del tipo cuando aplica (pilar, corona, cambio de arco…). */
  detail?: string;
  /** true: es un control o una atención sin procedimiento sobre la pieza; el odontograma solo cambia si hay hallazgos nuevos. */
  control: boolean;
};

export const EVOLUTION_TYPE_LABEL: Record<EvolutionType, string> = {
  urgencia: "Urgencia",
  "implante-instalacion": "Instalación de implante",
  "implante-rehabilitacion": "Rehabilitación sobre implante",
  "implante-control": "Control de implante",
  endodoncia: "Endodoncia",
  exodoncia: "Exodoncia",
  obturacion: "Procedimiento restaurador (obturación)",
  protesis: "Prótesis",
  ortodoncia: "Ortodoncia / ortopedia",
  higiene: "Higiene (profilaxis / destartraje)",
  pulido: "Pulido coronario",
  preventivo: "Preventivo (sellantes / flúor)",
  control: "Control",
  evaluacion: "Evaluación / examen",
  atencion: "Atención",
};

const fold = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();

/** Quita la próxima cita («control en 3 semanas», «se controla en…»): no dice qué se hizo hoy. */
function withoutNextVisit(text: string): string {
  return text
    .replace(/\b(?:proxim[oa]\s+(?:control|cita|sesion)|(?:se\s+)?(?:controla(?:ra|mos)?|control|citar?|cita|agenda|vuelve|volver|nos\s+vemos))\s+(?:en|el|la|para|dentro|al|a\s+control)\b[^.;\n]*/g, " ")
    .replace(/\bse\s+cita\b[^.;\n]*/g, " ");
}

const DONE = String.raw`(?:se\s+(?:realiza|realizo|hace|hizo|efectua|efectuo|instala|instalo|coloca|coloco|cementa|cemento|atornilla|atornillo|conecta|conecto|inserta|inserto|entrega|entrego|ajusta|ajusto|cambia|cambio|activa|activo)|instalad[oa]s?\s+(?:hoy|en\s+esta\s+sesion)|cementad[oa]\s+hoy|realizad[oa]\s+hoy|hoy\s+se)`;
const DONE_RE = new RegExp(String.raw`\b${DONE}\b`);

function near(text: string, a: RegExp, b: RegExp, window = 60): boolean {
  for (const match of text.matchAll(new RegExp(a.source, "g"))) {
    const start = Math.max(0, (match.index ?? 0) - window);
    const slice = text.slice(start, (match.index ?? 0) + match[0].length + window);
    if (b.test(slice)) return true;
  }
  return false;
}

function titleFor(type: EvolutionType, detail: string | undefined, text: string): string {
  switch (type) {
    case "implante-control": return "Control de implante";
    case "implante-instalacion": return "Instalación de implante";
    case "implante-rehabilitacion": return detail === "corona" ? "Corona sobre implante" : `Instalación de ${detail ?? "pilar"} sobre implante`;
    case "obturacion": return "Obturación";
    case "ortodoncia": return detail && detail !== "control" ? `Ortodoncia: ${detail}` : "Control de ortodoncia";
    case "higiene": {
      const parts = [/\bprofilaxis\b/.test(text) ? "profilaxis" : "", /\b(?:destartraje|detartraje|tartrectomia)\b/.test(text) ? "destartraje" : "", /\b(?:limpieza|higiene|aseo)\b/.test(text) && !/\b(?:profilaxis|destartraje|detartraje)\b/.test(text) ? "higiene" : "", /\braspado|pulido\s+radicular\b/.test(text) ? "raspado y pulido radicular" : ""].filter(Boolean);
      const head = parts.length ? parts.join(" y ") : "higiene";
      const polish = detail ? ` ${detail}` : "";
      return `${head.charAt(0).toUpperCase()}${head.slice(1)}${polish}`;
    }
    case "pulido": return "Pulido coronario";
    case "preventivo": return "Preventivo";
    case "protesis": return "Prótesis";
    default: return EVOLUTION_TYPE_LABEL[type];
  }
}

/** Clasifica lo hecho en la sesión. `tooth` es la pieza principal ya leída («FDI 3.6»), si la hay. */
export function classifyEvolution(text: string, tooth?: string | null): EvolutionKind {
  const all = fold(text);
  const today = withoutNextVisit(all);
  const performed = DONE_RE.test(today);
  const make = (type: EvolutionType, detail?: string, control = false): EvolutionKind => {
    const label = EVOLUTION_TYPE_LABEL[type];
    const base = titleFor(type, detail, today);
    return { type, label, title: tooth ? `${base} · ${tooth}` : base, ...(detail ? { detail } : {}), control };
  };

  const implant = /\bimplantes?\b/.test(today);
  const isControl = /\b(?:control\w*|seguimiento|revision|chequeo|estable|oseointegrad\w*)\b/.test(today);

  if (/\burgencia\b|\bdolor\s+agudo\b|\bdrenaje\b/.test(today)) return make("urgencia");
  if (implant) {
    const crown = /\b(?:corona|protesis\s+fija|rehabilitacion)\b/;
    const pilar = /\b(?:pilar(?:es)?|aditamento|tornillo\s+de\s+cicatrizacion|cicatrizal)\b/;
    const verb = new RegExp(String.raw`\b(?:${DONE}|instalacion|cementacion|conexion|colocacion|entrega)\b`);
    if (near(today, crown, verb) && !/\bprovisori[ao]\b/.test(today)) return make("implante-rehabilitacion", "corona");
    if (near(today, pilar, verb)) return make("implante-rehabilitacion", /cicatriz/.test(today) ? "pilar de cicatrización" : "pilar");
    if (/\b(?:se\s+(?:instala|instalo|coloca|coloco|inserta|inserto)\s+(?:un\s+|el\s+)?implante|instalacion\s+de(?:l)?\s+(?:un\s+)?implante|cirugia\s+de\s+implante|implante\s+instalado\s+hoy)\b/.test(today)) return make("implante-instalacion");
    // Un control del implante no vuelve a marcarlo; «pieza 2.1 corona sobre implante» sin control ni
    // procedimiento es un registro del examen y sigue con las reglas generales (evaluación/atención).
    if (isControl) return make("implante-control", undefined, true);
  }
  if (/\b(?:endodoncia|conductometria|biopulpectomia|necropulpectomia|pulpectomia|pulpotomia|trepanacion|instrumentacion|obturacion\s+de\s+conductos?|conductos?\s+radicular)/.test(today) && !/\b(?:se\s+indica|planific|presupuest)\w*\s+(?:la\s+)?endodoncia\b/.test(today)) return make("endodoncia");
  if (/\b(?:se\s+(?:realiza|realizo|hace|hizo)\s+(?:la\s+)?(?:exodoncia|extraccion)|se\s+extra(?:e|jo)|exodoncia\s+(?:simple|quirurgica|de\s+(?:la\s+)?pieza)|extraccion\s+(?:simple|quirurgica))\b/.test(today)) return make("exodoncia");
  if (/\b(?:obturacion|obtura|restauracion|restaura|resina|amalgama|ionomero)\w*\b/.test(today) && (performed || /\bse\s+(?:obtura|restaura)\b/.test(today))) return make("obturacion");
  if (/\b(?:protesis|ppr|placa\s+acrilica|rebasad\w*|prueba\s+de\s+(?:dientes|enfilado|metal)|enfilado|cubeta\s+individual)\b/.test(today)) return make("protesis", undefined, !performed);
  if (/\b(?:ortodon\w*|ortoped\w*|brackets?|arco|elasticos?|alineador\w*|disyuntor|expansor\w*|placa\s+(?:de\s+)?(?:expansion|hawley|activa)|retenedor\w*|ligaduras?|quad\s*helix)\b/.test(today)) {
    const detail = /\bcambi\w*\s+(?:de\s+)?arco|\barco\s+(?:a|nuevo)|\bse\s+cambia\s+(?:el\s+)?arco/.test(today) ? "cambio de arco"
      : /\bactiva\w*/.test(today) ? "activación"
      : /\b(?:instalacion|se\s+instala|se\s+cementa)\b/.test(today) ? "instalación"
      : "control";
    return make("ortodoncia", detail, detail === "control");
  }
  const hygiene = /\b(?:profilaxis|destartraje|detartraje|tartrectomia|limpieza|higiene|aseo|raspado|pulido\s+radicular|ultrasonido|prophy)\b/.test(today);
  const polish = /\bpulido\b/.test(today);
  if (hygiene) return make("higiene", polish && !/\bpulido\s+radicular\b/.test(today) ? "con pulido coronario" : undefined);
  if (polish) return make("pulido");
  if (/\b(?:sellantes?|barniz|fluor|fluoruro)\b/.test(today) && performed) return make("preventivo");
  if (isControl) return make("control", undefined, true);
  if (/\b(?:primera\s+consulta|examen|evaluacion|diagnostico|ingreso)\b/.test(today)) return make("evaluacion", undefined, true);
  return make("atencion", undefined, !performed);
}
