import type { ToothPhoto } from "@/lib/tooth-photos";

/**
 * Foto de la pieza con sus capas (caries, obturaciones con la textura de su material, sellante). Todo se dibuja en el
 * mismo recuadro 420×576 y se invierte/espeja junto, así las capas siguen alineadas con la base.
 * `intrinsic`: el alto lo da la proporción (ventana grande); si no, rellena el contenedor (miniaturas).
 */
export function PhotoStack({ photo, alt, intrinsic = false, eager = false }: { photo: ToothPhoto; alt: string; intrinsic?: boolean; eager?: boolean }) {
  const layers = photo.layers ?? [];
  const box = intrinsic ? "relative block w-full" : "relative block h-full w-full";
  return (
    <span className={box} style={{ transform: photo.transform, ...(intrinsic ? { aspectRatio: "420 / 576" } : null) }} data-testid="photo-stack" data-face={photo.face ?? "vestibular"}>
      <img src={photo.src} alt={alt} width={420} height={576} loading={eager ? undefined : "lazy"} decoding="async" className="absolute inset-0 h-full w-full object-cover" />
      {layers.map(layer => layer.material
        ? <span key={`${layer.kind}-${layer.surface}`} aria-hidden="true" data-layer={layer.kind} data-surface={layer.surface} data-material={layer.material.name} className="pointer-events-none absolute inset-0 block" style={{ WebkitMaskImage: `url(${layer.src})`, maskImage: `url(${layer.src})`, WebkitMaskSize: "100% 100%", maskSize: "100% 100%", backgroundImage: `url(${layer.material.src})`, backgroundSize: "60% auto", mixBlendMode: "normal" }} />
        : <img key={`${layer.kind}-${layer.surface}`} src={layer.src} alt="" aria-hidden="true" width={420} height={576} loading={eager ? undefined : "lazy"} decoding="async" data-layer={layer.kind} data-surface={layer.surface} className="pointer-events-none absolute inset-0 h-full w-full object-cover" />)}
    </span>
  );
}
