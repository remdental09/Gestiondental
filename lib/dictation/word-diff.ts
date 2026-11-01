/** Diferencia palabra a palabra entre el texto dictado y el corregido, para marcar qué cambió. */
export type DiffSegment = { type: "same" | "added" | "removed"; text: string };

const MAX_CELLS = 400_000;

const words = (text: string): string[] => text.split(/\s+/).filter(Boolean);

/** Une segmentos contiguos del mismo tipo con un espacio. */
function merge(segments: DiffSegment[]): DiffSegment[] {
  const out: DiffSegment[] = [];
  for (const segment of segments) {
    const last = out[out.length - 1];
    if (last && last.type === segment.type) last.text = `${last.text} ${segment.text}`;
    else out.push({ ...segment });
  }
  return out;
}

/**
 * LCS por palabras. Las palabras borradas se muestran antes de las agregadas en cada tramo cambiado.
 * Con textos muy largos (más de ~400 mil celdas) se marca todo como reemplazado para no trabar el teléfono.
 */
export function wordDiff(before: string, after: string): DiffSegment[] {
  const a = words(before), b = words(after);
  if (!a.length && !b.length) return [];
  if (a.length * b.length > MAX_CELLS) return merge([...a.map((text) => ({ type: "removed" as const, text })), ...b.map((text) => ({ type: "added" as const, text }))]);
  const n = a.length, m = b.length;
  const table = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) table[i][j] = a[i] === b[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
  const out: DiffSegment[] = [];
  let i = 0, j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && a[i] === b[j]) { out.push({ type: "same", text: a[i] }); i++; j++; continue; }
    const removed: string[] = [], added: string[] = [];
    while ((i < n || j < m) && !(i < n && j < m && a[i] === b[j])) {
      if (j >= m || (i < n && table[i + 1][j] >= table[i][j + 1])) removed.push(a[i++]);
      else added.push(b[j++]);
    }
    if (removed.length) out.push({ type: "removed", text: removed.join(" ") });
    if (added.length) out.push({ type: "added", text: added.join(" ") });
  }
  return merge(out);
}

/** Cuántas palabras cambiaron (agregadas o quitadas), para el resumen «N cambios». */
export function changedWordCount(segments: DiffSegment[]): number {
  return segments.filter((segment) => segment.type !== "same").reduce((sum, segment) => sum + words(segment.text).length, 0);
}
