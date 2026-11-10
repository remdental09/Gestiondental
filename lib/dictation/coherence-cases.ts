import type { DictationProposal, OdontogramChange } from "./proposal.ts";

export type CoherenceCase = {
  id: string; nota: string; trampa?: boolean;
  /** Requiere la comprensión de la IA (actos clínicos): no se exige con solo reglas. */
  soloIA?: boolean;
  chart: { tooth: number; status: string; foundation?: "tooth" | "implant" }[];
  dictado: string; aplica?: string[]; noAplica?: string[]; confirmar?: string[];
  /** Códigos del arancel que deben proponerse (marcados) y los que no deben proponerse marcados. */
  prestaciones?: string[]; noPrestaciones?: string[];
};

export const itemKey = (item: OdontogramChange) =>
  item.kind === "surface" ? `${item.tooth} ${item.surface} ${item.finding?.condition}`
    : item.kind === "crown" ? `${item.tooth} Corona:${item.foundation ?? "tooth"}`
    : `${item.tooth} ${item.status}`;

/** Fallas de un caso: lo que debía aplicarse y no, lo que no debía aplicarse solo y quedó marcado, etc. */
export function judgeCase(test: CoherenceCase, proposal: DictationProposal): string[] {
  const marked = new Set(proposal.odontogram.filter((item) => !item.advisory && !item.conflict).map(itemKey));
  const waiting = new Set(proposal.odontogram.filter((item) => item.advisory && item.coherence === "reemplaza").map(itemKey));
  const fails: string[] = [];
  for (const key of test.aplica ?? []) if (!marked.has(key)) fails.push(`debía aplicarse «${key}»`);
  for (const key of test.noAplica ?? []) if (marked.has(key)) fails.push(`se aplicaría solo «${key}» y no debe`);
  const codes = new Set((proposal.prestaciones ?? []).filter((item) => !item.advisory).map((item) => item.code));
  for (const code of test.prestaciones ?? []) if (!codes.has(code)) fails.push(`debía cobrarse ${code}`);
  for (const code of test.noPrestaciones ?? []) if (codes.has(code)) fails.push(`se cobraría ${code} y no debe`);
  for (const key of test.confirmar ?? []) if (!waiting.has(key)) fails.push(`«${key}» debía quedar esperando confirmación${marked.has(key) ? " (quedó marcado)" : ""}`);
  return fails;
}
