"use client";
/**
 * Lee en el propio equipo los códigos de una etiqueta: QR, Data Matrix (UDI de implantes) y códigos de barras.
 * Usa ZXing compilado a WebAssembly, servido desde la propia aplicación y cargado solo cuando se necesita.
 */
import wasmUrl from "zxing-wasm/reader/zxing_reader.wasm?url";
import type { CodeRead } from "@/lib/product-code";

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

/** Códigos encontrados en una foto o en un cuadro de la cámara (vacío si no hay ninguno). */
export async function readCodes(source: Blob | ImageData): Promise<CodeRead[]> {
  const { readBarcodes } = await reader();
  const scan = async (input: Blob | ImageData) => (await readBarcodes(input, {
    formats: ["DataMatrix", "QRCode", "MicroQRCode", "Code128", "EAN13", "EAN8", "UPCA", "ITF"], tryHarder: true, maxNumberOfSymbols: 6,
  })).filter(item => item.isValid && item.text);
  let found = await scan(source);
  // El lector no abre todos los formatos de imagen (p. ej. WebP): se reintenta con los puntos ya decodificados por el navegador.
  if (!found.length && source instanceof Blob && source.type === "image/webp") found = await scan(await pixels(source));
  // Los códigos 2D primero: traen lote y vencimiento; el de barras suele traer solo el número del producto.
  return found.sort((a, b) => Number(isSquareCode(b.format)) - Number(isSquareCode(a.format)))
    .map(item => ({ text: item.text.replace(/<GS>/g, "\x1d"), format: item.format, gs1: /^\](?:C1|d2|Q3|e0)/.test(item.symbologyIdentifier) }));
}

export const isSquareCode = (format = "") => /Matrix|QR/i.test(format);

async function pixels(blob: Blob): Promise<ImageData> {
  const image = await createImageBitmap(blob);
  const canvas = document.createElement("canvas");
  canvas.width = image.width; canvas.height = image.height;
  const context = canvas.getContext("2d")!;
  context.drawImage(image, 0, 0); image.close();
  return context.getImageData(0, 0, canvas.width, canvas.height);
}
