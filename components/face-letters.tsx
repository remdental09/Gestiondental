import { surfaceScreenSide } from "@/app/odontogram-surface";
import type { ToothFace } from "@/lib/tooth-photos";

/**
 * Iniciales de las caras sobre el recuadro de la foto: M y D a los lados (mesial mira a la línea media), O del lado de la
 * corona y, arriba a la izquierda, la cara que se está viendo (V, o P/L si es la vista de atrás). Se orientan con la misma
 * regla del dibujo oclusal; en la vista palatina/lingual se ve la pieza desde atrás, así que M y D cambian de lado.
 */
export function FaceLetters({ tooth, face = "vestibular" }: { tooth: number; face?: ToothFace }) {
  const back = face === "palatina";
  const side = (surface: "M" | "D") => {
    const s = surfaceScreenSide(tooth, surface);
    return back ? (s === "left" ? "right" : "left") : s;
  };
  const quadrant = Math.floor(tooth / 10);
  const lowerArch = quadrant === 3 || quadrant === 4 || quadrant === 7 || quadrant === 8;
  const crownBottom = !lowerArch;
  const chip = "pointer-events-none absolute flex h-6 w-6 items-center justify-center rounded-full bg-black/55 text-[11px] font-bold text-white ring-1 ring-white/30";
  const pos = (s: string) => (s === "left" ? "left-1.5 top-1/2 -translate-y-1/2" : "right-1.5 top-1/2 -translate-y-1/2");
  const lingual = lowerArch;
  return (
    <span aria-hidden="true" data-testid="face-letters" className="pointer-events-none absolute inset-0 block">
      <span className={`${chip} left-1.5 top-1.5`} title={back ? (lingual ? "Cara lingual" : "Cara palatina") : "Cara vestibular"}>{back ? (lingual ? "L" : "P") : "V"}</span>
      <span className={`${chip} ${pos(side("M"))}`} title="Mesial">M</span>
      <span className={`${chip} ${pos(side("D"))}`} title="Distal">D</span>
      <span className={`${chip} left-1/2 -translate-x-1/2 ${crownBottom ? "bottom-8" : "top-1.5"}`} title="Oclusal / incisal">O</span>
    </span>
  );
}
