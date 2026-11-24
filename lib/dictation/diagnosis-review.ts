/**
 * Diagnósticos CIE-11 en la revisión del dictado: qué se muestra y qué parte marcado.
 * Toda nota con procedimiento o hallazgo sale con su CIE-11 propuesto y marcado, para que no se pierda al guardar;
 * el profesional lo ve con la marca «propuesto», lo cambia o lo desmarca (decide él). Se guarda con su origen.
 */
type ReviewableDx = { code: string; tooth?: number; suggested?: { from?: string } | null };
type OdontogramLike = { tooth: number; kind?: string; finding?: { condition?: string } | null };

/** Parte desmarcado solo lo que no tiene código (nada que guardar). Lo deducido o aproximado parte marcado como propuesto. */
export function dxStartsChecked(item: ReviewableDx): boolean {
  return Boolean(item.code);
}

/**
 * Lista de diagnósticos a revisar. La caries DA08.0 que sale de una cara con caries del odontograma se guarda junto
 * con esa cara (no se repite aquí); la que no tiene cara en el odontograma («caries en la raíz») sí se revisa aquí.
 */
export function reviewableDiagnoses<T extends ReviewableDx>(diagnoses: T[], odontogram: OdontogramLike[]): T[] {
  const cariesTeeth = new Set(odontogram.filter((change) => change.kind === "surface" && change.finding?.condition === "caries").map((change) => change.tooth));
  return diagnoses.filter((item) => !item.code.startsWith("DA08.0") || (item.tooth !== undefined && !cariesTeeth.has(item.tooth)));
}

/** Al elegir una opción de «¿olvidaste el diagnóstico?», reemplaza la propuesta automática de esa pieza. */
export function withoutAutoProposal<T extends ReviewableDx>(items: T[], tooth: number | undefined): T[] {
  return items.filter((item) => !((item.tooth ?? undefined) === tooth && item.suggested?.from === "nota"));
}
