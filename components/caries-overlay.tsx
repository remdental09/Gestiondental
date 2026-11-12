import type { CariesSpot } from "@/lib/tooth-photos";

const SURFACE_NAME: Record<CariesSpot["surface"], string> = { V: "vestibular", P: "palatina/lingual", M: "mesial", D: "distal", O: "oclusal" };
const DEPTH_NAME: Record<string, string> = { esmalte: "esmalte", dentina_superficial: "dentina superficial", dentina_profunda: "dentina profunda", pulpar: "compromiso pulpar" };

export function cariesSpotText(spot: CariesSpot): string {
  return `caries ${SURFACE_NAME[spot.surface]}${spot.depth ? ` (${DEPTH_NAME[spot.depth]})` : ""}`;
}

/** Lesiones de caries sobre la foto referencial, en la cara que registra la ficha. */
export function CariesOverlay({ spots, labels = true, cover = false }: { spots: CariesSpot[]; labels?: boolean; cover?: boolean }) {
  if (!spots.length) return null;
  return (
    <svg viewBox="0 0 420 576" preserveAspectRatio={cover ? "xMidYMid slice" : "xMidYMid meet"} className="pointer-events-none absolute inset-0 h-full w-full" aria-hidden="true" data-testid="caries-overlay">
      <defs>
        <radialGradient id="caries-lesion" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#1a0b04" stopOpacity="0.95" />
          <stop offset="55%" stopColor="#4a2510" stopOpacity="0.85" />
          <stop offset="85%" stopColor="#8a5a2b" stopOpacity="0.45" />
          <stop offset="100%" stopColor="#8a5a2b" stopOpacity="0" />
        </radialGradient>
      </defs>
      {spots.map(spot => (
        <g key={spot.surface} data-surface={spot.surface}>
          <ellipse cx={spot.x} cy={spot.y} rx={spot.rx} ry={spot.ry} fill="url(#caries-lesion)" opacity={spot.back ? 0.55 : 1} />
          <ellipse cx={spot.x} cy={spot.y} rx={spot.rx + 6} ry={spot.ry + 6} fill="none" stroke="#f43f5e" strokeWidth={4} strokeDasharray={spot.back ? "10 8" : undefined} opacity={0.9} />
          {labels && <g>
            <rect x={spot.labelX - 17} y={spot.labelY - 15} width={34} height={30} rx={9} fill="#e11d48" />
            <text x={spot.labelX} y={spot.labelY + 7} textAnchor="middle" fontSize={20} fontWeight={700} fill="#fff" fontFamily="system-ui, sans-serif">{spot.surface}</text>
          </g>}
        </g>
      ))}
    </svg>
  );
}
