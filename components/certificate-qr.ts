"use client";
/**
 * Lee el código QR del Certificado de inscripción (RNPI) en el propio teléfono: dibuja cada página del PDF con pdf.js
 * (unpdf) y busca el QR con jsQR. Devuelve su contenido y un recorte PNG del QR para guardarlo junto al certificado.
 * Se cargan bajo demanda (solo al subir un certificado) para no pesar en el resto de la app.
 */
export type FoundQr = { payload: string; image: Blob };

type Located = { data: string; location: { topLeftCorner: { x: number; y: number }; bottomRightCorner: { x: number; y: number }; topRightCorner: { x: number; y: number }; bottomLeftCorner: { x: number; y: number } } };

const toBlob = (canvas: HTMLCanvasElement) => new Promise<Blob | null>(resolve => canvas.toBlob(blob => resolve(blob), "image/png"));

/** Busca un QR en un lienzo; si lo encuentra, devuelve su contenido y un recorte (con margen blanco) de hasta 600 px. */
async function findInCanvas(canvas: HTMLCanvasElement): Promise<FoundQr | null> {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  const { default: jsQR } = await import("jsqr");
  const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const found = jsQR(pixels.data, canvas.width, canvas.height, { inversionAttempts: "attemptBoth" }) as Located | null;
  if (!found?.data) return null;
  const xs = [found.location.topLeftCorner.x, found.location.topRightCorner.x, found.location.bottomLeftCorner.x, found.location.bottomRightCorner.x];
  const ys = [found.location.topLeftCorner.y, found.location.topRightCorner.y, found.location.bottomLeftCorner.y, found.location.bottomRightCorner.y];
  const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const margin = size * 0.12;
  const x = Math.max(0, Math.min(...xs) - margin), y = Math.max(0, Math.min(...ys) - margin);
  const w = Math.min(canvas.width - x, Math.max(...xs) - Math.min(...xs) + margin * 2), h = Math.min(canvas.height - y, Math.max(...ys) - Math.min(...ys) + margin * 2);
  const out = document.createElement("canvas");
  const scale = Math.min(1, 600 / Math.max(w, h));
  out.width = Math.max(1, Math.round(w * scale)); out.height = Math.max(1, Math.round(h * scale));
  const octx = out.getContext("2d");
  if (!octx) return null;
  octx.fillStyle = "#fff"; octx.fillRect(0, 0, out.width, out.height);
  octx.imageSmoothingEnabled = false;
  octx.drawImage(canvas, x, y, w, h, 0, 0, out.width, out.height);
  const image = await toBlob(out);
  return image ? { payload: found.data, image } : null;
}

/** QR del PDF del certificado (primeras 2 páginas). null si no se encontró. */
export async function extractQrFromPdf(file: Blob): Promise<FoundQr | null> {
  const { getDocumentProxy } = await import("unpdf");
  const pdf = await getDocumentProxy(new Uint8Array(await file.arrayBuffer()));
  {
    for (let number = 1; number <= Math.min(pdf.numPages, 2); number++) {
      const page = await pdf.getPage(number);
      // 2,5× basta para un QR de ~2 cm; se limita el lienzo para no agotar la memoria del iPhone.
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2.5, 2400 / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport, canvas } as unknown as Parameters<typeof page.render>[0]).promise;
      const found = await findInCanvas(canvas);
      if (found) return found;
    }
    // Respaldo: el QR del certificado de la Superintendencia es una imagen incrustada (JPEG 256×256); se lee directo.
    return await qrFromEmbeddedImages(pdf);
  }
}

/** QR de una foto o captura (cuando no se pudo leer del PDF). */
export async function extractQrFromImage(file: Blob): Promise<FoundQr | null> {
  const url = URL.createObjectURL(file);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => { const img = new window.Image(); img.onload = () => resolve(img); img.onerror = () => reject(new Error("No se pudo abrir la imagen.")); img.src = url; });
    const scale = Math.min(1, 2400 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale)); canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height); ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await findInCanvas(canvas);
  } finally { URL.revokeObjectURL(url); }
}

type PdfProxy = Awaited<ReturnType<typeof import("unpdf")["getDocumentProxy"]>>;
type PdfImage = { width?: number; height?: number; bitmap?: CanvasImageSource; data?: Uint8Array | Uint8ClampedArray };
/** Busca el QR entre las imágenes incrustadas del PDF (el certificado del RNPI trae el QR como JPEG aparte). */
async function qrFromEmbeddedImages(pdf: PdfProxy): Promise<FoundQr | null> {
  try {
    const { getResolvedPDFJS } = await import("unpdf");
    const { OPS } = await getResolvedPDFJS();
    for (let number = 1; number <= Math.min(pdf.numPages, 2); number++) {
      const page = await pdf.getPage(number);
      const ops = await page.getOperatorList();
      for (let k = 0; k < ops.fnArray.length; k++) {
        if (ops.fnArray[k] !== OPS.paintImageXObject) continue;
        const id = String(ops.argsArray[k]?.[0] ?? "");
        if (!id) continue;
        const store = id.startsWith("g_") ? page.commonObjs : page.objs;
        const image = await new Promise<PdfImage | null>(resolve => {
          const timer = setTimeout(() => resolve(null), 3000);
          try { store.get(id, (value: unknown) => { clearTimeout(timer); resolve(value as PdfImage); }); } catch { clearTimeout(timer); resolve(null); }
        });
        const width = image?.width ?? 0, height = image?.height ?? 0;
        if (!image || width < 40 || height < 40 || width > 3000 || height > 3000 || Math.abs(width - height) > Math.max(width, height) * 0.25) continue;
        // Se agrega un margen blanco: el QR incrustado suele venir sin zona de silencio.
        const pad = Math.round(Math.max(width, height) * 0.12);
        const canvas = document.createElement("canvas"); canvas.width = width + pad * 2; canvas.height = height + pad * 2;
        const ctx = canvas.getContext("2d", { willReadFrequently: true }); if (!ctx) continue;
        ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
        if (image.bitmap) ctx.drawImage(image.bitmap, pad, pad);
        else if (image.data && image.data.length === width * height * 4) ctx.putImageData(new ImageData(new Uint8ClampedArray(image.data), width, height), pad, pad);
        else if (image.data && image.data.length === width * height * 3) {
          const rgba = new Uint8ClampedArray(width * height * 4);
          for (let i = 0, j = 0; i < image.data.length; i += 3, j += 4) { rgba[j] = image.data[i]; rgba[j + 1] = image.data[i + 1]; rgba[j + 2] = image.data[i + 2]; rgba[j + 3] = 255; }
          ctx.putImageData(new ImageData(rgba, width, height), pad, pad);
        } else continue;
        const found = await findInCanvas(canvas);
        if (found) return found;
      }
    }
  } catch { /* sin respaldo */ }
  return null;
}

/** Solo las imágenes incrustadas (para pruebas y como respaldo). */
export async function extractQrFromPdfImages(file: Blob): Promise<FoundQr | null> {
  const { getDocumentProxy } = await import("unpdf");
  return qrFromEmbeddedImages(await getDocumentProxy(new Uint8Array(await file.arrayBuffer())));
}
