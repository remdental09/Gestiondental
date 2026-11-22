/** Claves de R2 y cabeceras de las imágenes clínicas (servidor). */
export const thumbKey = (objectKey: string) => objectKey + ".thumb.jpg";
/** Privada (solo el navegador de quien inició sesión), un día: la grilla no vuelve a descargar todo en cada visita. */
export const IMAGE_CACHE_CONTROL = "private, max-age=86400";
