"use client";
import { MARK_LABEL, type ToothMark, type ToothMarkKind } from "@/lib/tooth-treatments";
import { toothPhotoFor, type CariesSpotInput, type ImplantPhase } from "@/lib/tooth-photos";
import { CariesOverlay, cariesSpotText } from "@/components/caries-overlay";

const STATUS_TEXT = { planificado: "planificado", "en curso": "en curso", realizado: "realizado" } as const;
const COLOR: Record<ToothMarkKind, string> = { endodoncia: "#d9743f", perno: "#6b7280", carilla: "#2563eb", onlay: "#b8860b", protesis: "#0e7490", ortodoncia: "#7c3aed" };

/**
 * Vista ampliada y esquemática de una pieza (corte lateral: corona arriba, raíz abajo; vestibular a la izquierda).
 * Dibuja lo que el odontograma chico no alcanza a mostrar: endodoncia, perno, carilla, incrustación, prótesis fija y ortodoncia.
 * Lo planificado va con línea punteada; lo realizado, lleno.
 */
export function ToothDetailView({ toothLabel, marks, crown = false, absent = false, fdi, status, implant = false, implantPhase, caries = false, restored = false, endoDone = false, cariesSurfaces = [], restoredSurfaces = [] }: { toothLabel: string; marks: ToothMark[]; crown?: boolean; absent?: boolean; fdi?: number; status?: string; implant?: boolean; implantPhase?: ImplantPhase; caries?: boolean; restored?: boolean; endoDone?: boolean; cariesSurfaces?: CariesSpotInput[]; restoredSurfaces?: CariesSpotInput["surface"][] }) {
  const mark = (kind: ToothMarkKind) => marks.find((item) => item.kind === kind);
  const dash = (kind: ToothMarkKind) => (mark(kind)?.status === "planificado" ? "6 5" : undefined);
  const soft = (kind: ToothMarkKind) => (mark(kind)?.status === "realizado" ? 1 : 0.55);
  const endo = mark("endodoncia"), perno = mark("perno"), carilla = mark("carilla"), onlay = mark("onlay"), protesis = mark("protesis"), orto = mark("ortodoncia");
  const endoShown = Boolean(endo && endo.status !== "planificado") || endoDone;
  const photo = fdi ? toothPhotoFor({ fdi, status, implant, implantPhase, crown, endo: endoShown, caries, restored, cariesSurfaces, restoredSurfaces }) : null;
  const plannedEndo = Boolean(endo && endo.status === "planificado" && !endoDone && !crown && !implant);
  return <div className="mt-4 rounded-xl border border-[#dddbe6] bg-white p-4" data-testid="tooth-detail-view">
    <p className="text-sm font-semibold text-[#3b3355]">Vista ampliada · FDI {toothLabel}</p>
    <div className="mt-2 flex flex-wrap items-start gap-5">
      {photo ? <figure className="relative m-0 w-[210px] shrink-0 overflow-hidden max-sm:mx-auto rounded-xl bg-[#14161b]" data-testid="tooth-photo" data-kind={photo.kind}>
        <img src={photo.src} alt={`Imagen referencial de la pieza ${toothLabel}: ${absent ? "ausente" : photo.kind === "lesion" ? (status ?? "estado general") : photo.kind === "sano" ? "sin tratamientos registrados" : photo.kind.replace("-", " ")}`} width={420} height={576} loading="lazy" decoding="async" className="block h-auto w-full" style={{ transform: photo.transform, opacity: absent ? 0.18 : 1, filter: absent ? "grayscale(1)" : undefined }} />
        {!absent && <CariesOverlay spots={photo.lesions} />}
        {absent && <figcaption className="absolute inset-x-0 top-1/2 -translate-y-1/2 text-center text-sm font-semibold text-white">Ausente</figcaption>}
        {plannedEndo && <span className={`absolute left-2 ${photo.upper ? "bottom-2" : "top-2"} rounded-full bg-[#f5b946] px-2 py-0.5 text-[11px] font-semibold text-[#3b2a05]`}>Planificado</span>}
        <p className={`absolute inset-x-0 ${photo.upper ? "top-0" : "bottom-0"} bg-black/55 px-2 py-1 text-center text-[10px] text-white/80`}>Imagen referencial, no es el paciente</p>
      </figure> : <svg viewBox="0 0 240 320" role="img" aria-label={`Esquema ampliado de la pieza ${toothLabel}: ${marks.length ? marks.map((item) => `${item.label} ${STATUS_TEXT[item.status]}`).join(", ") : "sin tratamientos dibujados"}`} className="h-[300px] w-[225px] shrink-0">
        <text x="14" y="18" fontSize="11" fill="#6b6a7c">vestibular</text>
        <text x="226" y="18" fontSize="11" fill="#6b6a7c" textAnchor="end">palatino / lingual</text>
        {/* Raíz */}
        <path d="M78 150 C82 215 100 285 120 300 C140 285 158 215 162 150 Z" fill="#f4ecd8" stroke="#b9a98a" strokeWidth="2" opacity={absent ? 0.25 : 1} />
        {/* Corona */}
        <path d="M70 150 C52 120 56 58 92 42 C108 34 132 34 148 42 C184 58 188 120 170 150 Z" fill={absent ? "#f2f5f5" : "#fbf8ef"} stroke={crown ? "#0284c7" : "#b9a98a"} strokeWidth={crown ? 5 : 2} strokeDasharray={absent ? "5 5" : undefined} />
        {crown && <text x="120" y="62" fontSize="11" textAnchor="middle" fill="#0369a1" fontWeight="600">corona</text>}
        {/* Cámara y conducto */}
        {!endo && !absent && <path d="M112 96 C112 86 128 86 128 96 L124 150 L121 282 L119 282 L116 150 Z" fill="#f1c7c0" opacity="0.7" />}
        {endo && <path d="M111 94 C111 84 129 84 129 94 L125 150 L121.5 284 L118.5 284 L115 150 Z" fill={endo.status === "realizado" ? COLOR.endodoncia : "none"} stroke={COLOR.endodoncia} strokeWidth="2.5" strokeDasharray={endo.status === "realizado" ? undefined : "5 4"} />}
        {/* Perno dentro del conducto y muñón */}
        {perno && <g opacity={soft("perno")}><rect x="114" y="104" width="12" height="108" rx="3" fill={perno.status === "planificado" ? "none" : COLOR.perno} stroke={COLOR.perno} strokeWidth="2" strokeDasharray={dash("perno")} /><rect x="104" y="92" width="32" height="20" rx="5" fill={perno.status === "planificado" ? "none" : COLOR.perno} stroke={COLOR.perno} strokeWidth="2" strokeDasharray={dash("perno")} /></g>}
        {/* Incrustación sobre la cara oclusal */}
        {onlay && <path d="M84 50 C100 34 140 34 156 50 C150 74 90 74 84 50 Z" fill={onlay.status === "planificado" ? "none" : COLOR.onlay} fillOpacity="0.55" stroke={COLOR.onlay} strokeWidth="3" strokeDasharray={dash("onlay")} />}
        {/* Carilla en la cara vestibular */}
        {carilla && <path d="M66 148 C48 120 52 60 88 44" fill="none" stroke={COLOR.carilla} strokeWidth="8" strokeLinecap="round" strokeDasharray={dash("carilla")} opacity={soft("carilla")} />}
        {/* Prótesis fija: contorno de la corona con conectores a las piezas vecinas */}
        {protesis && <g opacity={soft("protesis")}><path d="M64 152 C44 120 50 54 90 37 C108 28 132 28 150 37 C190 54 196 120 176 152 Z" fill="none" stroke={COLOR.protesis} strokeWidth="4" strokeDasharray={dash("protesis") ?? "10 4"} /><line x1="8" y1="96" x2="52" y2="96" stroke={COLOR.protesis} strokeWidth="6" strokeLinecap="round" /><line x1="188" y1="96" x2="232" y2="96" stroke={COLOR.protesis} strokeWidth="6" strokeLinecap="round" /></g>}
        {/* Bracket y arco */}
        {orto && <g opacity={soft("ortodoncia")}><line x1="10" y1="98" x2="56" y2="98" stroke={COLOR.ortodoncia} strokeWidth="2.5" strokeDasharray={dash("ortodoncia")} /><rect x="42" y="86" width="20" height="24" rx="3" fill={orto.status === "planificado" ? "none" : COLOR.ortodoncia} stroke={COLOR.ortodoncia} strokeWidth="2" strokeDasharray={dash("ortodoncia")} /></g>}
        {absent && <text x="120" y="170" fontSize="14" textAnchor="middle" fill="#6b6a7c" fontWeight="600">Ausente</text>}
        <text x="120" y="314" fontSize="10" textAnchor="middle" fill="#6b6a7c">Esquema, no a escala</text>
      </svg>}
      <div className="min-w-[180px] flex-1 text-sm">
        {photo && photo.lesions.length > 0 && <p className="mb-2 font-medium text-rose-800" data-testid="tooth-photo-caries">Caries registrada: {photo.lesions.map(cariesSpotText).map(t => t.replace(/^caries /, "")).join(", ")}. Marcada en rojo sobre la imagen.</p>}
        {marks.length === 0 && !crown ? <p className="text-[#6b6a7c]">Sin endodoncia, perno, carilla, incrustación, prótesis ni ortodoncia registradas en esta pieza.</p> : <ul className="space-y-2">
          {crown && <li className="flex items-center gap-2"><span className="size-3 rounded-full" style={{ background: "#0284c7" }} />Corona <span className="text-xs text-[#6b6a7c]">registrada</span></li>}
          {marks.map((item) => <li key={item.kind} className="flex items-center gap-2"><span className="size-3 rounded-full" style={{ background: COLOR[item.kind] }} />{MARK_LABEL[item.kind]} <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${item.status === "realizado" ? "bg-emerald-100 text-emerald-900" : item.status === "en curso" ? "bg-amber-100 text-amber-900" : "bg-[#fde9df] text-[#9a4a26]"}`}>{STATUS_TEXT[item.status]}</span></li>)}
        </ul>}
        {photo ? <p className="mt-3 text-xs text-[#6b6a7c]" data-testid="tooth-photo-note">La imagen muestra la situación principal de la pieza{photo.kind === "corona" && !endoShown ? " (la corona aparece sobre una pieza con conductos tratados)" : ""}. Perno, carilla, incrustación, prótesis y ortodoncia constan en la lista. Se arma con tu plan y tus evoluciones.</p> : <p className="mt-3 text-xs text-[#6b6a7c]">Lleno: realizado. Punteado: planificado. Se arma con tu plan y tus evoluciones.</p>}
      </div>
    </div>
  </div>;
}
