/** Lector mínimo de .zip para el navegador (y Node ≥ 18): solo entradas sin cifrar, almacenadas o comprimidas con deflate. */
export type ZipEntry = { name: string; data: Uint8Array };

const MAX_ENTRIES = 50;
const MAX_ENTRY_BYTES = 40_000_000;

async function inflateRaw(bytes: Uint8Array, expected: number): Promise<Uint8Array> {
  const stream = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const out = new Uint8Array(await new Response(stream).arrayBuffer());
  if (out.length !== expected) throw new Error("El archivo comprimido está dañado.");
  return out;
}

export async function readZip(buffer: ArrayBuffer): Promise<ZipEntry[]> {
  const bytes = new Uint8Array(buffer), view = new DataView(buffer);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) if (view.getUint32(i, true) === 0x06054b50) { end = i; break; }
  if (end < 0) throw new Error("No es un archivo .zip válido.");
  const count = view.getUint16(end + 10, true);
  let pos = view.getUint32(end + 16, true);
  if (count > MAX_ENTRIES) throw new Error("El .zip trae demasiados archivos.");
  const decoder = new TextDecoder("utf-8");
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (view.getUint32(pos, true) !== 0x02014b50) throw new Error("El .zip está dañado.");
    const flags = view.getUint16(pos + 8, true), method = view.getUint16(pos + 10, true);
    const compressed = view.getUint32(pos + 20, true), size = view.getUint32(pos + 24, true);
    const nameLength = view.getUint16(pos + 28, true), extraLength = view.getUint16(pos + 30, true), commentLength = view.getUint16(pos + 32, true);
    const local = view.getUint32(pos + 42, true);
    const name = decoder.decode(bytes.subarray(pos + 46, pos + 46 + nameLength));
    pos += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;
    if (flags & 1) throw new Error("El .zip está protegido con contraseña.");
    if (size > MAX_ENTRY_BYTES) throw new Error("Un archivo del .zip es demasiado grande.");
    if (view.getUint32(local, true) !== 0x04034b50) throw new Error("El .zip está dañado.");
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + compressed);
    if (method === 0) entries.push({ name, data: raw.slice() });
    else if (method === 8) entries.push({ name, data: await inflateRaw(raw, size) });
    else throw new Error("El .zip usa una compresión no compatible.");
  }
  return entries;
}
