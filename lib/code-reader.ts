"use client";
/**
 * Lee en el propio equipo los códigos de una etiqueta: QR, Data Matrix (UDI de implantes) y códigos de barras.
 * Usa ZXing compilado a WebAssembly, servido desde la propia aplicación y cargado solo cuando se necesita.
 */
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";

let ready: Promise<typeof import("zxing-wasm/reader")> | null = null;
function reader() {
  ready ??= import("zxing-wasm/reader").then(async library => {
    await library.prepareZXingModule({ overrides: { locateFile: (path: string, prefix: string) => path.endsWith(".wasm") ? wasmUrl : prefix + path }, fireImmediately: true });
    return library;
  }).catch(error => { ready = null; throw error; });
  return ready;
}

/** Carga el lector antes de usarlo (al abrir la cámara). */
export const warmCodeReader = () => reader().then(() => undefined);

/** Textos de los códigos encontrados en una foto o en un cuadro de la cámara (vacío si no hay ninguno). */
export async function readCodes(source: Blob | ImageData): Promise<string[]> {
  const { readBarcodes } = await reader();
  const found = await readBarcodes(source, {
    formats: ["DataMatrix", "QRCode", "MicroQRCode", "Code128", "EAN13", "EAN8", "UPCA", "ITF"], tryHarder: true, maxNumberOfSymbols: 6,
  });
  // Los códigos 2D primero: traen lote y vencimiento; el de barras suele traer solo el número del producto.
  return found.filter(item => item.isValid && item.text)
    .sort((a, b) => Number(/Matrix|QR/.test(b.format)) - Number(/Matrix|QR/.test(a.format)))
    .map(item => item.text);
}
