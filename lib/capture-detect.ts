/**
 * Ubica solas las vistas de Blue Sky Plan en una captura de su ventana completa. No interpreta la imagen:
 * separa los recuadros por sus líneas divisorias y reconoce cada uno por el color de su regla.
 * Si no está seguro de una vista, no la entrega.
 */
export type Pixels = { width: number; height: number; data: Uint8ClampedArray | Uint8Array };
export type Rect = { x: number; y: number; width: number; height: number };
export type DetectedView = "Transversal" | "Axial" | "Panorámica" | "Vista 3D";

type Color = readonly [number, number, number];
const RULERS = {
  panoramic: [178, 229, 153], tangential: [78, 229, 53], axial: [102, 178, 255],
  crossA: [150, 150, 216], crossB: [216, 108, 108],
} as const satisfies Record<string, Color>;

/** Recuadro negro más grande de la ventana: ahí viven las vistas; la barra y los paneles claros quedan fuera. */
function viewportOf({ width, height, data }: Pixels): Rect | null {
  const step = 2, columns = Math.floor(width / step), rows = Math.floor(height / step);
  const open = new Uint8Array(columns * rows);
  for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
    const i = (row * step * width + column * step) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
    open[row * columns + column] = Math.min(r, g, b) >= 180 && Math.max(r, g, b) - Math.min(r, g, b) < 20 ? 0 : 1;
  }
  const stack = new Int32Array(columns * rows);
  let best: Rect | null = null, bestCount = 0;
  for (let start = 0; start < open.length; start++) {
    if (!open[start]) continue;
    let size = 0, count = 0, left = columns, right = 0, top = rows, bottom = 0;
    stack[size++] = start; open[start] = 0;
    while (size) {
      const at = stack[--size], column = at % columns, row = (at - column) / columns;
      count++;
      left = Math.min(left, column); right = Math.max(right, column); top = Math.min(top, row); bottom = Math.max(bottom, row);
      for (const next of [column > 0 ? at - 1 : -1, column < columns - 1 ? at + 1 : -1, at - columns, at + columns]) {
        if (next >= 0 && next < open.length && open[next]) { open[next] = 0; stack[size++] = next; }
      }
    }
    if (count > bestCount) { bestCount = count; best = { x: left * step, y: top * step, width: (right - left + 1) * step, height: (bottom - top + 1) * step }; }
  }
  return best && best.width >= width * 0.3 && best.height >= height * 0.3 ? best : null;
}

const MIN_SIDE = 90;

/** Divide por las líneas grises que cruzan todo un recuadro, con negro a ambos lados. */
function split(image: Pixels, rect: Rect, depth = 0): Rect[] {
  const { width, data } = image;
  const at = (x: number, y: number) => (y * width + x) * 4;
  const line = (i: number) => { const low = Math.min(data[i], data[i + 1], data[i + 2]), high = Math.max(data[i], data[i + 1], data[i + 2]); return low >= 75 && high <= 150 && high - low < 14; };
  const black = (i: number) => data[i] < 16 && data[i + 1] < 16 && data[i + 2] < 16;
  let best: { vertical: boolean; position: number; share: number } | null = null;
  if (depth < 5) for (const vertical of [false, true]) {
    const from = vertical ? rect.x : rect.y, length = vertical ? rect.width : rect.height;
    const across = vertical ? rect.y : rect.x, span = vertical ? rect.height : rect.width;
    for (let position = from + MIN_SIDE; position < from + length - MIN_SIDE; position++) {
      let hits = 0, total = 0;
      for (let other = across; other < across + span; other += 2) {
        const index = (offset: number) => vertical ? at(position + offset, other) : at(other, position + offset);
        total++;
        if (line(index(0)) && [1, 2, 3, 4].some(d => black(index(-d))) && [1, 2, 3, 4].some(d => black(index(d)))) hits++;
      }
      const share = hits / total;
      if (share >= 0.85 && (!best || share > best.share)) best = { vertical, position, share };
    }
  }
  if (!best) return [rect];
  const { vertical, position } = best;
  const first = vertical ? { ...rect, width: position - 1 - rect.x } : { ...rect, height: position - 1 - rect.y };
  const second = vertical ? { ...rect, x: position + 3, width: rect.x + rect.width - position - 3 } : { ...rect, y: position + 3, height: rect.y + rect.height - position - 3 };
  return [...split(image, first, depth + 1), ...split(image, second, depth + 1)];
}

function count({ width, data }: Pixels, area: Rect, match: (r: number, g: number, b: number) => boolean) {
  let found = 0;
  for (let y = area.y; y < area.y + area.height; y++) for (let x = area.x; x < area.x + area.width; x++) {
    const i = (y * width + x) * 4;
    if (match(data[i], data[i + 1], data[i + 2])) found++;
  }
  return found;
}

function classify(image: Pixels, rect: Rect): DetectedView | null {
  const strip = Math.max(28, Math.round(rect.height * 0.07));
  const bottom = { x: rect.x, y: rect.y + rect.height - strip, width: rect.width, height: strip };
  const near = (color: Color) => count(image, bottom, (r, g, b) => Math.abs(r - color[0]) <= 14 && Math.abs(g - color[1]) <= 14 && Math.abs(b - color[2]) <= 14);
  const enough = Math.max(30, rect.width * 0.12);
  const panoramic = near(RULERS.panoramic), tangential = near(RULERS.tangential), axial = near(RULERS.axial);
  const cross = near(RULERS.crossA) + near(RULERS.crossB);
  if (panoramic >= enough && panoramic > tangential) return "Panorámica";
  if (cross >= enough && cross > axial && cross > tangential) return "Transversal";
  // El corte tangencial tiene regla verde y no es ninguno de los tipos de la ficha.
  if (tangential >= enough && tangential > axial) return null;
  if (axial >= enough) return "Axial";
  // La vista 3D no tiene regla: lleva su rótulo amarillo arriba a la izquierda.
  if (panoramic + tangential + axial + cross >= enough) return null;
  const corner = { x: rect.x, y: rect.y, width: Math.round(rect.width * 0.5), height: Math.max(40, Math.round(rect.height * 0.12)) };
  return count(image, corner, (r, g, b) => r >= 170 && g >= 170 && b <= 80 && Math.abs(r - g) <= 30) >= 25 ? "Vista 3D" : null;
}

/** Ancho de la columna de botones que Blue Sky pone a la derecha de cada vista, si se distingue de la imagen; si no, 0. */
function buttonsOf({ width, data }: Pixels, rect: Rect): number {
  const lit = (x: number) => {
    for (let y = rect.y + 4; y < rect.y + Math.min(rect.height, 110); y++) { const i = (y * width + x) * 4; if (Math.max(data[i], data[i + 1], data[i + 2]) > 60) return true; }
    return false;
  };
  const limit = rect.x + rect.width - 60;
  let x = rect.x + rect.width - 1;
  while (x > limit && !lit(x)) x--;
  const end = x;
  while (x > limit && lit(x)) x--;
  const buttons = end - x;
  return buttons >= 14 && buttons <= 48 && x > limit && !lit(x - 1) ? rect.x + rect.width - x : 0;
}

export function findViews(image: Pixels): Partial<Record<DetectedView, Rect>> {
  const viewport = viewportOf(image);
  if (!viewport) return {};
  const panels = split(image, viewport).filter(rect => rect.width >= MIN_SIDE && rect.height >= MIN_SIDE)
    .map(rect => ({ rect, view: classify(image, rect), buttons: buttonsOf(image, rect) }));
  // La columna mide lo mismo en todas las vistas: donde la imagen llega hasta los botones se usa la de las demás.
  const usual = Math.max(0, ...panels.map(panel => panel.buttons));
  const found: Partial<Record<DetectedView, Rect>> = {};
  for (const { rect, view, buttons } of panels) {
    if (!view) continue;
    const clean = { ...rect, width: rect.width - (buttons || usual) }, previous = found[view];
    if (!previous) { found[view] = clean; continue; }
    const x = Math.min(previous.x, clean.x), y = Math.min(previous.y, clean.y);
    found[view] = { x, y, width: Math.max(previous.x + previous.width, clean.x + clean.width) - x, height: Math.max(previous.y + previous.height, clean.y + clean.height) - y };
  }
  return found;
}
