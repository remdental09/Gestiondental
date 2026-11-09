/**
 * Modelo clínico de la pieza dentaria.
 *
 * En vez de reglas sueltas («si dice trepanación, no implante»), cada pieza tiene un SUSTRATO
 * (diente natural, alvéolo vacío o implante) y cada cambio se valida contra dos cosas:
 *   1) el paso desde lo ya registrado: ¿es posible pasar de A a B y qué evento lo exige?
 *   2) la coherencia interna del dictado: lo que se le hace hoy a la pieza ¿es compatible con el sustrato final?
 * Así un caso nuevo (que nadie previó) cae igual en la misma lógica.
 */

export type Substrate = "natural" | "ausente" | "implante" | "desconocido";

/** Lo que el dictado dice que pasó HOY en esa pieza (no lo que se planifica). */
export type ToothEvents = {
  extraction: boolean;       // se extrajo
  implantInstalled: boolean; // se instaló un implante
  implantRemoved: boolean;   // se retiró/explantó un implante
  abutment: boolean;         // pilar protésico
  crownPlaced: boolean;      // se cementó/instaló una corona
  pulpWork: boolean;         // trepanación, pulpitis, endodoncia, pulpa, conductos, vitalidad
  surfaceWork: boolean;      // caries u obturación en sus caras
};

export type ChartTooth = { tooth: number; status: string; foundation?: "tooth" | "implant" };
export type ProposedState = { status: string; foundation?: "tooth" | "implant" };

export type Verdict =
  /** replaces: cambia lo registrado. supported: un hecho dictado HOY explica el cambio (extracción, instalación, pilar, corona). */
  | { ok: true; replaces: boolean; supported?: boolean }
  | { ok: false; reason: string };

/** Sustrato de un estado del odontograma. «Sin hallazgos» no es «sano confirmado»: es que no hay registro. */
export function substrateOf(state: ProposedState | undefined): Substrate {
  if (!state || state.status === "Sin hallazgos") return "desconocido";
  if (state.status === "Implante" || state.status === "Implante con pilar") return "implante";
  if (state.status === "Corona") return state.foundation === "implant" ? "implante" : "natural";
  if (state.status === "Ausente") return "ausente";
  return "natural"; // Indicación de exodoncia, Resto radicular con endodoncia
}

const fold = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const NEG = /(?<![a-z])(?:no\s+(?:se\s+)?|sin\s+|niega\s+|descart\w*\s+)/;
/** Solo cuenta si no está negado ni en futuro/plan («se planifica extracción»). */
const LATER = /(?<![a-z])(?:planific\w*|se\s+indica|indicad\w*|a\s+futuro|proxim\w*|programad\w*|agendad\w*|presupuest\w*|cotiz\w*|diferid\w*|se\s+(?:instalara|colocara|extraera|realizara)|en\s+\w+\s+(?:semanas|meses))(?![a-z])/;

const EVENT_PATTERNS: Record<keyof ToothEvents, RegExp> = {
  extraction: /(?<![a-z])(?:se\s+(?:extrae|extrajo|realiza\s+(?:la\s+)?(?:extraccion|exodoncia))|extraccion|exodoncia|extraid[oa]|avulsion)(?![a-z])/,
  implantInstalled: /(?<![a-z])(?:se\s+(?:instala|instalo|coloca|coloco|inserta|inserto)\w*[^.;]{0,60}implante|(?:instalacion|colocacion|insercion)\s+(?:de(?:l)?\s+)?(?:un\s+)?implante|implante\s+inmediato|cirugia\s+de\s+implante)/,
  implantRemoved: /(?<![a-z])(?:explant\w*|(?:se\s+)?retir\w*\s+(?:el\s+)?implante|implante\s+(?:fracasad\w*|perdid\w*|retirad\w*))/,
  abutment: /(?<![a-z])pilar(?:es)?(?![a-z])/,
  crownPlaced: /(?<![a-z])(?:se\s+(?:cementa|cemento|instala|instalo|atornilla|atornillo)\w*[^.;]{0,40}corona|corona[^.;]{0,30}(?:cementad\w*|instalad\w*|atornillad\w*))/,
  pulpWork: /(?<![a-z])(?:trepan\w*|pulpitis|pulpectom\w*|pulpotom\w*|endodonc\w*|conductos?|necrosis\s+pulpar|pulpa(?:r)?|tejido\s+(?:nervioso|pulpar)|camara\s+pulpar|hidroxido\s+de\s+calcio|medicacion\s+intraconducto|test\s+de\s+(?:frio|vitalidad)|sensib\w*\s+al\s+frio|dolor\s+(?:provocado\s+)?(?:por|al)\s+(?:el\s+)?(?:frio|calor))(?![a-z])/,
  surfaceWork: /(?<![a-z])(?:caries|obtura\w*|restaura\w*|resina|amalgama|composite|ionomero|sellante)(?![a-z])/,
};

/** Eventos de HOY para una pieza, a partir de las frases que hablan solo de ella. */
export function eventsFrom(ownSentences: string[]): ToothEvents {
  const events: ToothEvents = { extraction: false, implantInstalled: false, implantRemoved: false, abutment: false, crownPlaced: false, pulpWork: false, surfaceWork: false };
  for (const raw of ownSentences) {
    const sentence = fold(raw);
    if (LATER.test(sentence)) continue;
    for (const key of Object.keys(EVENT_PATTERNS) as (keyof ToothEvents)[]) {
      const match = EVENT_PATTERNS[key].exec(sentence);
      if (!match) continue;
      // «no se extrae», «sin caries», «niega dolor al frío»: no ocurrió.
      const before = sentence.slice(Math.max(0, match.index - 18), match.index);
      if (NEG.test(before)) continue;
      events[key] = true;
    }
  }
  return events;
}

const label = (s: Substrate) => ({ natural: "diente natural", ausente: "pieza ausente", implante: "implante", desconocido: "sin registro" })[s];

/**
 * ¿Es clínicamente posible que la pieza quede en `next`, dado lo registrado y lo que se hizo hoy?
 * `replaces` = cambia un estado ya registrado (para mostrar «antes → después» y pedir confirmación).
 */
export function checkTransition(current: ChartTooth | undefined, next: ProposedState, events: ToothEvents): Verdict {
  const from = substrateOf(current), to = substrateOf(next);

  // 1) Coherencia interna: lo que se le hace hoy debe poder hacerse sobre el sustrato final.
  if (to === "implante" && events.pulpWork && !events.extraction)
    return { ok: false, reason: "el dictado describe pulpa o conductos en esta pieza (trepanación, pulpitis, endodoncia o vitalidad), propios de un diente natural; un implante no tiene pulpa." };
  if (to === "implante" && events.surfaceWork && !events.extraction && !events.implantInstalled)
    return { ok: false, reason: "el dictado le registra caries u obturaciones, propias de un diente natural, no de un implante." };
  if (to === "ausente" && (events.pulpWork || events.surfaceWork || events.crownPlaced) && !events.extraction)
    return { ok: false, reason: "se le hace un tratamiento hoy pero quedaría como ausente; una pieza ausente no se trata." };
  if (to === "natural" && events.implantInstalled && !events.implantRemoved)
    return { ok: false, reason: "el dictado dice que hoy se instaló un implante, pero el cambio la deja como diente natural." };

  // 2) Paso desde lo registrado. Sin registro previo, cualquier sustrato observado es un primer registro.
  if (from === "desconocido") return { ok: true, replaces: false };
  const ok = (supported: boolean): Verdict => ({ ok: true, replaces: true, supported });
  if (from === to) {
    const same = current?.status === next.status && (next.status !== "Corona" || (current?.foundation ?? next.foundation) === next.foundation);
    if (same) return { ok: true, replaces: false };
    if (current?.status === "Implante con pilar" && next.status === "Implante")
      return { ok: false, reason: "ya tiene pilar registrado y el cambio lo devuelve a implante sin pilar, sin que se diga que se retiró." };
    if (current?.status === "Implante" && next.status === "Implante con pilar") return ok(events.abutment);
    if (next.status === "Corona") return ok(events.crownPlaced);
    return ok(false);
  }
  if (from === "natural" && to === "ausente")
    return events.extraction ? ok(true) : { ok: false, reason: `figura como ${label(from)} (${current?.status}) y quedaría ausente sin que se diga que se extrajo.` };
  if (from === "natural" && to === "implante")
    return events.extraction && events.implantInstalled ? ok(true)
      : { ok: false, reason: `figura como ${label(from)} (${current?.status}${current?.foundation === "tooth" ? " sobre diente natural" : ""}); para ser implante hay que extraerla e instalar el implante, y el dictado no dice ${events.extraction ? "que se instaló el implante" : "que se extrajo"}.` };
  if (from === "ausente" && to === "implante")
    return events.implantInstalled || events.abutment ? ok(true) : { ok: false, reason: "figura ausente y quedaría con implante sin que se diga que se instaló." };
  if (from === "ausente" && to === "natural")
    return { ok: false, reason: `figura ausente y el cambio la deja como diente natural (${next.status}); un diente extraído no vuelve.` };
  if (from === "implante" && to === "natural")
    return { ok: false, reason: `figura con implante y el cambio la deja como diente natural (${next.status}); revisa si es la pieza correcta.` };
  if (from === "implante" && to === "ausente")
    return events.implantRemoved ? ok(true) : { ok: false, reason: "figura con implante y quedaría ausente sin que se diga que se retiró el implante." };
  return ok(false);
}

/** Las caras (caries, obturaciones, sellantes) solo existen en un diente natural. */
export function checkSurface(current: ChartTooth | undefined, finalState: ProposedState | undefined): Verdict {
  const sub = substrateOf(finalState ?? current);
  if (sub === "implante") return { ok: false, reason: "se le registra una cara (caries u obturación) pero es un implante; las caras son de un diente natural." };
  if (sub === "ausente") return { ok: false, reason: "se le registra una cara (caries u obturación) pero figura ausente." };
  return { ok: true, replaces: false };
}
