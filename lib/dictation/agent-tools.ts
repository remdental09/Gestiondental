import { searchPrestaciones, candidatePrestaciones, prestacionLabel } from "../prestaciones-catalog.ts";
import { searchDiagnoses } from "../icd11.ts";
import { IMPLANT_BRANDS, findImplantBrand } from "./implant-brands.ts";

/**
 * Herramientas de SOLO LECTURA que el agente de dictado puede consultar antes de devolver la propuesta.
 * Ninguna escribe en la ficha ni toca dinero: buscan en los catálogos locales (arancel, CIE-11, marcas de implantes).
 * Todo código que el modelo devuelva se vuelve a validar en proposal.ts contra esos mismos catálogos.
 */

export type AgentToolDefinition = {
  type: "function";
  function: { name: string; description: string; strict: true; parameters: Record<string, unknown> };
};

const queryParams = (description: string) => ({
  type: "object",
  additionalProperties: false,
  required: ["consulta"],
  properties: { consulta: { type: "string", description } },
});

export const AGENT_TOOLS: AgentToolDefinition[] = [
  {
    type: "function",
    function: {
      name: "buscar_prestacion",
      description: "Busca prestaciones del arancel dental por nombre o palabras clave (sin precios). Úsala cuando el procedimiento realizado hoy no aparezca en la lista de candidatas o haya que distinguir entre variantes. El arancel usa sus propios nombres: busca con esas palabras (p. ej. «tratamiento conductos molares superiores» o «premolares con lesion apical», no «endodoncia birradicular»). Devuelve código de 7 dígitos y nombre.",
      strict: true,
      parameters: queryParams("Procedimiento en palabras clínicas, p. ej. «endodoncia birradicular» o «corona cerámica sobre implante»"),
    },
  },
  {
    type: "function",
    function: {
      name: "buscar_diagnostico",
      description: "Busca diagnósticos CIE-11 verificados del catálogo de la aplicación por término clínico o sinónimo chileno. Úsala para escribir en «diagnosticos» un término que exista en el catálogo. Nunca inventes códigos.",
      strict: true,
      parameters: queryParams("Término diagnóstico, p. ej. «pulpitis irreversible» o «periodontitis apical asintomática»"),
    },
  },
  {
    type: "function",
    function: {
      name: "buscar_marca_implante",
      description: "Comprueba una marca o empresa de implantes dictada (la voz suele deformarlas). Devuelve coincidencias exactas o parecidas con su empresa. Si no hay una coincidencia clara, conserva lo dictado y pregunta en «dudas».",
      strict: true,
      parameters: queryParams("Marca o empresa tal como se oyó, p. ej. «Arxis ET de FSM»"),
    },
  },
];

const fold = (value: string) => value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** Distancia de edición (Levenshtein) acotada, para marcas mal transcritas. */
function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const row = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

/** Similitud 0–1 entre una palabra oída y un nombre del catálogo, comparando palabra a palabra. */
function similarity(heard: string, name: string): number {
  const words = fold(heard).split(" ").filter((word) => word.length >= 3);
  const target = fold(name);
  if (!words.length || !target) return 0;
  let best = 0;
  for (const word of words) {
    for (const piece of [target, ...target.split(" ")]) {
      if (piece.length < 3) continue;
      const distance = editDistance(word, piece);
      best = Math.max(best, 1 - distance / Math.max(word.length, piece.length));
    }
  }
  return best;
}

export function searchImplantBrands(query: string, limit = 5): Array<{ marca: string; empresa: string; pais: string; parecido: number }> {
  const exact = findImplantBrand(query);
  if (exact) return [{ marca: exact.brand, empresa: exact.company, pais: exact.region, parecido: 1 }];
  const scored = IMPLANT_BRANDS.map((item) => {
    const names = [item.brand, item.company, ...(item.aliases ?? [])];
    return { item, score: Math.max(...names.map((name) => similarity(query, name))) };
  }).filter((entry) => entry.score >= 0.6).sort((a, b) => b.score - a.score);
  return scored.slice(0, limit).map(({ item, score }) => ({ marca: item.brand, empresa: item.company, pais: item.region, parecido: Math.round(score * 100) / 100 }));
}

/** Ejecuta una herramienta y devuelve el texto JSON para el modelo. Nunca lanza: un error vuelve como mensaje. */
export function runAgentTool(name: string, rawArguments: string): string {
  let query = "";
  try {
    const parsed = JSON.parse(rawArguments || "{}") as { consulta?: unknown };
    query = typeof parsed.consulta === "string" ? parsed.consulta.slice(0, 200) : "";
  } catch {
    return JSON.stringify({ error: "Argumentos inválidos." });
  }
  if (!query.trim()) return JSON.stringify({ error: "Consulta vacía." });
  switch (name) {
    case "buscar_prestacion": {
      const direct = searchPrestaciones(query, 8);
      const seen = new Set(direct.map((item) => item.code));
      const broad = candidatePrestaciones(query, 12).filter((item) => !seen.has(item.code));
      const results = [...direct, ...broad].slice(0, 12).map((item) => ({ codigo: item.code, nombre: prestacionLabel(item.name), grupo: item.group }));
      return JSON.stringify({ resultados: results, nota: results.length ? "Usa un código solo si corresponde claramente a lo realizado hoy." : "Sin coincidencias: deja el código vacío." });
    }
    case "buscar_diagnostico": {
      const results = searchDiagnoses(query, 8).map((item) => ({ codigo: item.code || null, titulo: item.title, grupo: item.group }));
      return JSON.stringify({ resultados: results, nota: results.length ? "Escribe en «termino» el título tal como aparece." : "Sin coincidencias en el catálogo verificado: conserva el término dictado." });
    }
    case "buscar_marca_implante": {
      const results = searchImplantBrands(query);
      return JSON.stringify({ resultados: results, nota: results.length ? "Si el parecido es menor a 1, confírmalo en «dudas» antes de darlo por hecho." : "Marca no reconocida: consérvala tal como se dictó." });
    }
    default:
      return JSON.stringify({ error: `Herramienta desconocida: ${name}` });
  }
}
