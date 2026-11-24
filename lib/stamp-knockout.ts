/**
 * Quitar el fondo de la foto de un timbre y dejar solo la tinta (PNG con transparencia).
 * Puro (sin DOM): recibe los píxeles RGBA del canvas. El color del fondo se toma del borde de la foto (mediana), así sirve
 * para fondos blancos, grises o con sombra suave; lo que se parece al fondo pasa a transparente y la tinta se conserva.
 */
export type KnockoutResult = { data: Uint8ClampedArray; removed: number; background: [number, number, number] };

const median = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)] ?? 255; };

/** Color típico del borde (marco de ~3 % de la imagen). */
export function estimateBackground(data: ArrayLike<number>, width: number, height: number): [number, number, number] {
  const frame = Math.max(1, Math.round(Math.min(width, height) * 0.03));
  const channels: [number[], number[], number[]] = [[], [], []];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (x >= frame && x < width - frame && y >= frame && y < height - frame) { x = width - frame - 1; continue; }
      const i = (y * width + x) * 4;
      if ((data[i + 3] ?? 255) < 200) continue;
      channels[0].push(data[i] ?? 0); channels[1].push(data[i + 1] ?? 0); channels[2].push(data[i + 2] ?? 0);
    }
  }
  return [median(channels[0]), median(channels[1]), median(channels[2])];
}

/** Distancias de color (0–441) bajo la cual un píxel es fondo y sobre la cual es tinta; en medio, transparencia parcial (bordes suaves). */
export const KNOCKOUT_FROM = 28;
export const KNOCKOUT_TO = 95;

export function knockoutBackground(source: ArrayLike<number>, width: number, height: number): KnockoutResult {
  const background = estimateBackground(source, width, height);
  const out = new Uint8ClampedArray(width * height * 4);
  let removed = 0;
  for (let p = 0; p < width * height; p++) {
    const i = p * 4;
    const r = source[i] ?? 0, g = source[i + 1] ?? 0, b = source[i + 2] ?? 0, a = source[i + 3] ?? 255;
    const distance = Math.hypot(r - background[0], g - background[1], b - background[2]);
    const t = Math.min(1, Math.max(0, (distance - KNOCKOUT_FROM) / (KNOCKOUT_TO - KNOCKOUT_FROM)));
    const alpha = a * t * t * (3 - 2 * t);
    if (alpha < 1) { removed++; continue; }
    // Se quita la parte del fondo mezclada en los bordes para que no quede un halo gris alrededor de la tinta.
    const k = Math.max(t, 0.35);
    out[i] = Math.round(Math.min(255, Math.max(0, background[0] + (r - background[0]) / k)));
    out[i + 1] = Math.round(Math.min(255, Math.max(0, background[1] + (g - background[1]) / k)));
    out[i + 2] = Math.round(Math.min(255, Math.max(0, background[2] + (b - background[2]) / k)));
    out[i + 3] = Math.round(alpha);
  }
  return { data: out, removed: removed / (width * height), background };
}
