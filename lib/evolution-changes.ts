import { describeFinding, facesLabel, structureTranscript, type ChartSnapshot, type OdontogramChange, type OdontogramSurface } from "./dictation/proposal.ts";
import { formatFdiTooth } from "./tooth-numbering.ts";

/** Una tarjeta de la ventana «Se va a modificar el odontograma»: todo lo que cambia en una pieza. */
export type ChangeCard = {
  tooth: number;
  title: string;
  /** Cada línea: lo que había → lo que quedará. */
  lines: Array<{ label: string; before: string; after: string }>;
  ids: string[];
  /** Hay un aviso o una duda: arranca sin marcar. */
  review: boolean;
  note?: string;
};

const SURFACE_ORDER: OdontogramSurface[] = ["V", "P", "M", "D", "O"];

function surfaceBefore(chart: ChartSnapshot, tooth: number, surface: OdontogramSurface): string {
  const found = (chart.surfaces?.[tooth] ?? chart.surfaces?.[String(tooth) as unknown as number])?.[surface];
  if (!found || found.condition === "sound" || found.condition === "not_examined") return "Sin registro";
  return describeFinding(tooth, found as never, [surface]).replace(/\s*\(CIE.*$/i, "");
}

/** Lo que una evolución escrita o dictada cambiaría en el odontograma, sin tocar nada. Solo reglas: no sale texto de la ficha. */
export function proposeChangesFromEvolution(body: string, today: string, chart: ChartSnapshot, skipTeeth: number[] = []): { items: OdontogramChange[]; cards: ChangeCard[] } {
  const proposal = structureTranscript(body, { today });
  const skip = new Set(skipTeeth);
  const items = proposal.odontogram.filter((item) => {
    if (item.conflict || item.coherence === "incoherente" || skip.has(item.tooth)) return false;
    if (item.kind === "status") return item.status !== undefined && (chart.teeth?.[item.tooth] ?? "Sin hallazgos") !== item.status
      && !(chart.extras?.[item.tooth] ?? []).includes(item.status);
    if (item.kind === "crown") return (chart.teeth?.[item.tooth] ?? "") !== (item.foundation === "implant" ? "Implante" : "Corona") || !chart.crowns?.[item.tooth];
    if (item.kind === "surface" && item.surface && item.finding) {
      const current = (chart.surfaces?.[item.tooth] ?? chart.surfaces?.[String(item.tooth) as unknown as number])?.[item.surface];
      return !current || current.condition !== item.finding.condition || (Boolean(item.finding.restorationMaterial) && current.restorationMaterial !== item.finding.restorationMaterial);
    }
    return false;
  });
  const byTooth = new Map<number, OdontogramChange[]>();
  for (const item of items) byTooth.set(item.tooth, [...(byTooth.get(item.tooth) ?? []), item]);
  const cards: ChangeCard[] = [...byTooth].sort((a, b) => a[0] - b[0]).map(([tooth, list]) => {
    const lines: ChangeCard["lines"] = [];
    const surfaces = list.filter((item) => item.kind === "surface" && item.surface && item.finding);
    for (const item of [...surfaces].sort((a, b) => SURFACE_ORDER.indexOf(a.surface!) - SURFACE_ORDER.indexOf(b.surface!))) {
      lines.push({
        label: `Cara ${facesLabel(tooth, [item.surface!])}`,
        before: surfaceBefore(chart, tooth, item.surface!),
        after: describeFinding(tooth, item.finding!, [item.surface!]).replace(/\s*\(CIE.*$/i, ""),
      });
    }
    for (const item of list.filter((entry) => entry.kind !== "surface")) {
      const after = item.kind === "crown" ? (item.foundation === "implant" ? "Implante con corona" : `Corona${item.material ? ` de ${item.material.toLowerCase()}` : ""}`) : item.status ?? "";
      lines.push({ label: "Estado de la pieza", before: chart.teeth?.[tooth] ?? "Sin hallazgos", after });
    }
    const advisory = list.find((item) => item.advisory || item.coherence === "reemplaza");
    return {
      tooth, title: `Pieza ${formatFdiTooth(tooth)}`, lines, ids: list.map((item) => item.id), review: Boolean(advisory),
      ...(advisory ? { note: advisory.advisory ?? "Reemplaza lo ya registrado: revísalo." } : {}),
    };
  });
  return { items, cards };
}
