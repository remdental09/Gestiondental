export const attachmentFileName = (imageId: number, name: string, contentType: string) => {
  const extension = contentType === "application/pdf" ? ".pdf" : contentType === "image/png" ? ".png" : contentType === "image/webp" ? ".webp" : ".jpg";
  const base = name.replace(/[\\/:*?"<>|]/g, " ").replace(/\.(jpe?g|png|webp|pdf)$/i, "").trim().slice(0, 120) || "Adjunto";
  return `Adjunto ${imageId} - ${base}${extension}`;
};
