/**
 * Procedural anatomical tooth geometry (pure math, no three.js dependency).
 *
 * Local axes match the inspection stage: +Y occlusal/incisal, +Z vestibular,
 * mesial is +X on the patient's right (quadrants 1, 4, 5, 8) and −X on the left.
 * 1 unit ≈ 10 mm. The cemento-enamel junction (CEJ) sits at y = 0, so the crown
 * grows upward and the roots downward, and an implant platform at y = 0 meets
 * the prosthetic crown exactly where a natural crown would start.
 */
import { isPatientRight, isUpperTooth, toothKind, type ToothKind } from "@/app/tooth-3d-map";

export type ToothZone = "O" | "V" | "P" | "M" | "D" | "R" | "S";

export type AnatomyMesh = {
  /** Indexed, closed-around (no seam) surface so smooth normals have no visible seam. */
  positions: number[];
  indices: number[];
  /** One zone per triangle (indices.length / 3). R = root, S = cut dentine of a stump. */
  zones: ToothZone[];
  part: "body" | "root";
  /** Per vertex: 0 at the CEJ → 1 at the cusp tips / incisal edge; negative down the root (−1 = apex). */
  level: number[];
  /** Per vertex: 0–1 depth of an occlusal fissure (used for the dark stain in the grooves). */
  stain: number[];
  /** Optional per-vertex normals (implicit root complexes use the field gradient). */
  normals?: number[];
};

export type ToothAnatomy = {
  meshes: AnatomyMesh[];
  /** Polylines along each root canal, from the pulp chamber to the apex. */
  canals: [number, number, number][][];
};

export type AnatomyMode = "full" | "crown" | "stump";

type Cusp = [nx: number, nz: number, height: number, sx: number, sz: number];
type Groove = [x0: number, z0: number, x1: number, z1: number, depth: number, width: number];
/** tipX/tipZ: divergence reached near the apex; bend: extra (mostly distal) apical curvature; groove: longitudinal concavity depth. */
type RootSpec = { nx: number; nz: number; len: number; a: number; b: number; tipX: number; tipZ: number; bend?: number; groove?: number };

type Spec = {
  kind: ToothKind;
  md: number;
  bl: number;
  crownH: number;
  rootLen: number;
  /** Superellipse exponent of the crown section (2 = ellipse, higher = boxier). */
  n: number;
  cervMD: number;
  cervBL: number;
  /** Height (0–1 of the crown) of the mesiodistal contact / buccal / lingual height of contour. */
  contactU: number;
  buccalU: number;
  lingualU: number;
  /** Width left at the occlusal rim relative to the maximum. */
  rimMD: number;
  rimB: number;
  rimL: number;
  /** Fraction of the BL width that lies buccal of the long axis. */
  buccalShare: number;
  cejCurve: number;
  /** Rhomboid shear (buccal outline shifted mesially) for upper molars. */
  shear: number;
  cusps: Cusp[];
  grooves: Groove[];
  /** Edge-type crowns (incisor/canine): height of the incisal outline by nx. */
  edge?: (nx: number) => number;
  lingualFossa: number;
  roots: RootSpec[];
  trunk: number;
  rootCurve: number;
  /** Depth of the proximal longitudinal concavity on single roots. */
  rootGroove: number;
};

const MM = 0.1;

const clamp = (v: number, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const spow = (v: number, p: number) => Math.sign(v) * Math.pow(Math.abs(v), p);
const softAbs = (v: number, e = 0.004) => Math.sqrt(v * v + e);

/** Width profile along the crown: cervix → maximum at `peak` → rim. */
function profile(u: number, cerv: number, peak: number, rim: number, power = 1.4): number {
  if (u <= peak) {
    const s = u / Math.max(peak, 1e-6);
    // Eased start: the crown leaves the CEJ tangent to the root, then bulges to the contour.
    return cerv + (1 - cerv) * Math.sin((Math.PI / 2) * s * (0.35 + 0.65 * s));
  }
  return 1 - (1 - rim) * Math.pow((u - peak) / (1 - peak), power);
}

function segmentDistance(x: number, z: number, g: Groove): number {
  const [x0, z0, x1, z1] = g;
  const dx = x1 - x0, dz = z1 - z0;
  const t = clamp(((x - x0) * dx + (z - z0) * dz) / (dx * dx + dz * dz));
  return Math.hypot(x - (x0 + dx * t), z - (z0 + dz * t));
}

let lastStain = 0;

function occlusalHeight(spec: Spec, nx: number, nz: number): number {
  lastStain = 0;
  // Edge crowns: the incisal edge is rounded labiolingually rather than a flat ledge.
  if (spec.edge) return spec.edge(nx) - 0.045 * nz * nz;
  let h = 0;
  for (const [cx, cz, ch, sx, sz] of spec.cusps) {
    // Bulbous cusps: flatter, rounder tops with steeper slopes than a plain Gaussian.
    const r2 = ((nx - cx) / sx) ** 2 + ((nz - cz) / sz) ** 2;
    h += ch * Math.exp(-Math.pow(r2, 1.35));
    // Triangular ridge running from the cusp tip down towards the central fossa.
    const ridge: Groove = [cx, cz, cx * 0.3, cz * 0.3, 0, 0];
    const dr = segmentDistance(nx, nz, ridge);
    h += ch * 0.28 * Math.exp(-((dr / 0.13) ** 2)) * Math.exp(-r2 * 0.25);
  }
  let stain = 0;
  for (const g of spec.grooves) {
    const d = segmentDistance(nx, nz, g);
    // Fissures fade out before the outline so they never notch the marginal ridges.
    const fade = 1 - smooth(0.82, 1.02, Math.max(Math.abs(nx), Math.abs(nz)) * (Math.abs(g[3]) > 0.9 || Math.abs(g[1]) > 0.9 ? 0.86 : 1));
    // Sharper, deeper V-shaped fissure than the previous soft Gaussian.
    const w = g[5] * 0.8;
    h -= g[4] * 1.45 * Math.exp(-Math.pow(d / w, 1.4)) * fade;
    stain = Math.max(stain, Math.exp(-((d / (w * 1.7)) ** 2)) * fade);
  }
  // Marginal ridges close the occlusal table mesially and distally.
  h += 0.045 * Math.exp(-(((Math.abs(nx) - 0.8) / 0.13) ** 2)) * (1 - nz * nz * 0.6);
  lastStain = stain;
  return h;
}

function maxCusp(spec: Spec): number {
  let best = -Infinity;
  for (let i = 0; i <= 40; i += 1) for (let j = 0; j <= 40; j += 1) {
    const nx = -1 + (2 * i) / 40, nz = -1 + (2 * j) / 40;
    if (nx * nx + nz * nz > 1) continue;
    best = Math.max(best, occlusalHeight(spec, nx, nz));
  }
  return best;
}

function specFor(tooth: number): Spec {
  const kind = toothKind(tooth);
  const upper = isUpperTooth(tooth);
  const primary = Math.floor(tooth / 10) >= 5;
  const pos = tooth % 10;
  const base: Omit<Spec, "md" | "bl" | "crownH" | "rootLen"> = {
    kind, n: 2.3, cervMD: 0.72, cervBL: 0.86, contactU: 0.72, buccalU: 0.28, lingualU: 0.45,
    rimMD: 0.9, rimB: 0.82, rimL: 0.82, buccalShare: 0.5, cejCurve: 0.1, shear: 0,
    cusps: [], grooves: [], lingualFossa: 0, roots: [], trunk: 0, rootCurve: 0.06, rootGroove: 0.04,
  };
  let spec: Spec;
  if (kind === "incisor") {
    const central = pos === 1;
    const dims = upper ? (central ? [8.6, 7.0, 10.5, 13] : [6.6, 6.0, 9, 13]) : (central ? [5.2, 5.8, 9, 12.5] : [5.8, 6.1, 9.5, 14]);
    const distalRound = upper ? (central ? 0.07 : 0.16) : 0.04;
    spec = {
      ...base, md: dims[0] * MM, bl: dims[1] * MM, crownH: dims[2] * MM, rootLen: dims[3] * MM,
      n: 2.7, cervMD: upper ? 0.74 : 0.68, cervBL: 0.92, contactU: 0.82, buccalU: 0.14, lingualU: 0.16,
      rimMD: upper ? 0.97 : 0.99, rimB: 0.16, rimL: 0.12, buccalShare: 0.44, cejCurve: 0.36,
      edge: (nx) => {
        const m = Math.max(0, nx - 0.55) / 0.45, d = Math.max(0, -nx - 0.55) / 0.45;
        return -0.03 * m * m - distalRound * d * d;
      },
      lingualFossa: upper ? 0.62 : 0.4, rootCurve: 0.05, rootGroove: upper ? 0.03 : 0.14,
    };
  } else if (kind === "canine") {
    const dims = upper ? [7.6, 8.1, 10, 17] : [7.0, 7.6, 11, 16];
    spec = {
      ...base, md: dims[0] * MM, bl: dims[1] * MM, crownH: dims[2] * MM, rootLen: dims[3] * MM,
      n: 2.3, cervMD: 0.7, cervBL: 0.9, contactU: 0.66, buccalU: 0.2, lingualU: 0.2,
      rimMD: 0.98, rimB: 0.24, rimL: 0.2, buccalShare: 0.46, cejCurve: 0.3,
      edge: (nx) => {
        const tip = 0.08, d = nx - tip;
        // Shorter, steeper mesial cusp ridge; longer distal cusp ridge.
        const slope = d > 0 ? 0.3 / (1 - tip) : 0.38 / (1 + tip);
        return -slope * (softAbs(d, 0.002) - Math.sqrt(0.002));
      },
      lingualFossa: 0.32, rootCurve: 0.07, rootGroove: 0.1,
    };
  } else if (kind === "premolar") {
    const first = pos === 4;
    const dims = upper ? (first ? [7.0, 9.0, 8.5, 14] : [6.6, 9.0, 7.8, 14]) : (first ? [7.0, 7.6, 8.5, 14] : [7.2, 8.2, 8.0, 14.5]);
    const lingual = upper ? (first ? 0.13 : 0.16) : first ? 0.04 : 0.12;
    spec = {
      ...base, md: dims[0] * MM, bl: dims[1] * MM, crownH: dims[2] * MM, rootLen: dims[3] * MM,
      n: 2.25, cervMD: 0.72, cervBL: 0.84, contactU: 0.74, buccalU: 0.3, lingualU: 0.5,
      rimMD: 0.84, rimB: 0.72, rimL: upper ? 0.74 : 0.62, buccalShare: upper ? 0.5 : 0.56, cejCurve: 0.22,
      cusps: [
        [first && upper ? -0.06 : 0.04, 0.42, 0.2, 0.48, 0.4],
        [upper ? 0.06 : 0.12, upper ? -0.42 : -0.5, lingual, upper ? 0.45 : 0.36, 0.36],
      ],
      grooves: [[0.62, upper ? 0.02 : -0.05, -0.62, upper ? 0.02 : -0.05, 0.06, 0.09]],
      rootCurve: 0.07, rootGroove: 0.14,
    };
    if (upper && first && !primary) {
      spec.trunk = 0.4 * spec.rootLen;
      spec.roots = [
        { nx: 0, nz: 0.36, len: spec.rootLen, a: 0.2, b: 0.17, tipX: 0, tipZ: 0.14, bend: -0.07, groove: 0.1 },
        { nx: 0, nz: -0.36, len: spec.rootLen * 0.97, a: 0.19, b: 0.16, tipX: 0, tipZ: -0.13, bend: -0.05, groove: 0.08 },
      ];
    }
  } else {
    // Molars. Primary molars reuse the permanent design: 4 → first-molar-like small, 5 → first molar.
    const order = primary ? (pos === 5 ? 1 : 2) : pos - 5;
    if (upper) {
      const dims = order === 1 ? [10.2, 11.0, 7.5, 12.5] : order === 2 ? [9.0, 11.0, 7.0, 12] : [8.5, 10.0, 6.5, 11];
      const dp = order === 1 ? 0.13 : order === 2 ? 0.08 : 0.05;
      spec = {
        ...base, md: dims[0] * MM, bl: dims[1] * MM, crownH: dims[2] * MM, rootLen: dims[3] * MM,
        n: 2.6, cervMD: 0.78, cervBL: 0.84, contactU: 0.68, buccalU: 0.3, lingualU: 0.5,
        rimMD: 0.86, rimB: 0.74, rimL: 0.74, buccalShare: 0.48, cejCurve: 0.13, shear: 0.16,
        cusps: [
          [0.44, 0.5, 0.2, 0.36, 0.36],   // mesiobuccal
          [-0.46, 0.5, 0.18, 0.34, 0.36], // distobuccal
          [0.34, -0.4, 0.23, 0.48, 0.44], // mesiopalatal (largest)
          [-0.58, -0.52, dp, 0.3, 0.3],   // distopalatal
        ],
        grooves: [
          [0.62, 0.04, 0.02, 0.06, 0.08, 0.075],  // central groove to mesial pit
          [0.02, 0.06, -0.04, 1.0, 0.07, 0.07],   // buccal groove
          [-0.5, 0.04, -0.66, 0.08, 0.06, 0.07],  // distal pit
          [-0.5, 0.04, -0.18, -1.0, 0.07, 0.075], // distopalatal groove (oblique ridge stays raised)
        ],
        trunk: 0.32 * dims[3] * MM,
        roots: [
          { nx: 0.44, nz: 0.36, len: dims[3] * MM, a: 0.16, b: 0.22, tipX: 0.12, tipZ: 0.14, bend: -0.12, groove: 0.12 },
          { nx: -0.46, nz: 0.36, len: dims[3] * MM * 0.92, a: 0.14, b: 0.19, tipX: -0.16, tipZ: 0.12, bend: -0.05, groove: 0.05 },
          { nx: 0.04, nz: -0.42, len: dims[3] * MM * 1.06, a: 0.2, b: 0.19, tipX: 0, tipZ: -0.36, bend: 0, groove: 0.07 },
        ],
      };
    } else {
      const dims = order === 1 ? [11.2, 10.5, 7.5, 14] : order === 2 ? [10.5, 10.0, 7.0, 13] : [10.0, 9.5, 6.5, 11];
      const five = order === 1;
      spec = {
        ...base, md: dims[0] * MM, bl: dims[1] * MM, crownH: dims[2] * MM, rootLen: dims[3] * MM,
        n: 2.7, cervMD: 0.8, cervBL: 0.84, contactU: 0.7, buccalU: 0.26, lingualU: 0.52,
        rimMD: 0.88, rimB: 0.7, rimL: 0.8, buccalShare: 0.52, cejCurve: 0.12,
        cusps: five
          ? [
            [0.56, 0.48, 0.17, 0.3, 0.38],   // mesiobuccal
            [-0.04, 0.54, 0.16, 0.3, 0.36],  // distobuccal
            [-0.66, 0.36, 0.12, 0.24, 0.3],  // distal
            [0.5, -0.48, 0.21, 0.36, 0.38],  // mesiolingual
            [-0.36, -0.48, 0.19, 0.34, 0.38],// distolingual
          ]
          : [
            [0.46, 0.48, 0.17, 0.38, 0.38],
            [-0.46, 0.48, 0.16, 0.38, 0.38],
            [0.46, -0.48, 0.2, 0.38, 0.38],
            [-0.46, -0.48, 0.19, 0.38, 0.38],
          ],
        grooves: five
          ? [
            [0.78, 0.0, -0.78, 0.06, 0.08, 0.075], // central
            [0.26, 0.02, 0.3, 1.0, 0.07, 0.07],    // mesiobuccal
            [-0.36, 0.04, -0.46, 1.0, 0.06, 0.065],// distobuccal
            [0.08, 0.01, 0.06, -1.0, 0.07, 0.07],  // lingual
          ]
          : [
            [0.78, 0.0, -0.78, 0.0, 0.08, 0.075],
            [0.0, 0.0, 0.0, 1.0, 0.07, 0.07],
            [0.0, 0.0, 0.0, -1.0, 0.07, 0.07],
          ],
        trunk: 0.26 * dims[3] * MM,
        roots: [
          { nx: 0.5, nz: 0, len: dims[3] * MM, a: 0.16, b: 0.38, tipX: 0.1, tipZ: 0, bend: -0.2, groove: 0.16 },
          { nx: -0.5, nz: 0, len: dims[3] * MM * 0.93, a: 0.15, b: 0.34, tipX: -0.12, tipZ: 0, bend: -0.06, groove: 0.1 },
        ],
      };
    }
    if (primary) {
      // Primary molars: short trunk and thin, widely flared roots that leave room for the successor.
      spec.trunk = 0.16 * spec.rootLen;
      spec.roots = spec.roots.map((root) => ({ ...root, a: root.a * 0.72, b: root.b * 0.72, tipX: root.tipX + 0.22 * Math.sign(root.nx || 0), tipZ: root.tipZ + 0.18 * Math.sign(root.nz || 0) }));
    }
  }
  if (primary) {
    // Primary teeth: smaller, more bulbous crowns with a marked cervical constriction.
    const s = kind === "molar" ? 0.78 : 0.68;
    spec.md *= s; spec.bl *= s; spec.crownH *= s * 0.85; spec.rootLen *= s * 0.85;
    spec.cervMD *= 0.9; spec.cervBL *= 0.9; spec.buccalU = Math.min(spec.buccalU, 0.18);
    spec.trunk *= s * 0.85;
    spec.roots = spec.roots.map((root) => ({ ...root, len: root.len * s * 0.85 }));
    if (spec.edge) { const edge = spec.edge; spec.edge = (nx) => edge(nx) * 0.7; }
  }
  return spec;
}

const SEGMENTS = 72;
/** Vertices per ring; in "crown" mode the first ring is the cervical margin. */
export const ANATOMY_SEGMENTS = SEGMENTS;
const TRUNK_SHRINK = 0.14;
const CERVICAL_SHEAR = smooth(-0.2, 0.6, 0);

function ringAngles(): number[] {
  return Array.from({ length: SEGMENTS }, (_, i) => (i / SEGMENTS) * Math.PI * 2);
}

/** Unit superellipse direction for column i: returns (cx, cz) in [-1, 1]. */
function sectionUnit(phi: number, n: number): [number, number] {
  return [spow(Math.cos(phi), 2 / n), spow(Math.sin(phi), 2 / n)];
}

function wallZone(cx: number, cz: number, mesialSign: number): ToothZone {
  if (Math.abs(cz) >= Math.abs(cx)) return cz >= 0 ? "V" : "P";
  return cx * mesialSign >= 0 ? "M" : "D";
}

type Ring = { pts: [number, number, number][]; zone: (column: number) => ToothZone; level: number; stain?: number[] };

export function buildToothAnatomy(tooth: number, mode: AnatomyMode = "full"): ToothAnatomy {
  const spec = specFor(tooth);
  const mesial = isPatientRight(tooth) ? 1 : -1;
  const phis = ringAngles();
  const units = phis.map((phi) => sectionUnit(phi, spec.n));
  const rootUnits = phis.map((phi) => sectionUnit(phi, 2.05));
  const halfMD = spec.md / 2;
  const halfB = spec.bl * spec.buccalShare;
  const halfL = spec.bl * (1 - spec.buccalShare);
  const top = maxCusp(spec);
  const wallH = spec.crownH - Math.max(top, 0);
  const edgeTooth = Boolean(spec.edge);
  const cutU = mode === "stump" ? 0.22 : 1;

  // nx is mesial-positive, nz buccal-positive; x is world (mesial depends on quadrant).
  const toWorldX = (nxUnits: number, z: number, u: number) => (nxUnits + spec.shear * z * smooth(-0.2, 0.6, u)) * mesial;
  const cejOffset = (cx: number) => spec.cejCurve * Math.min(spec.md, spec.bl) * cx * cx;

  const wallPoint = (i: number, u: number): [number, number, number] => {
    const [cx, cz] = units[i];
    const a = halfMD * profile(u, spec.cervMD, spec.contactU, spec.rimMD);
    const bb = halfB * profile(u, spec.cervBL, spec.buccalU, spec.rimB, edgeTooth ? 1.5 : 1.4);
    const bl = halfL * profile(u, spec.cervBL, spec.lingualU, spec.rimL, edgeTooth ? 0.85 : 1.4);
    let z = cz >= 0 ? cz * bb : cz * bl;
    if (spec.lingualFossa > 0 && cz < 0) {
      // Shovel-shaped lingual fossa between the marginal ridges, above the cingulum.
      const w = smooth(0.2, 0.55, u) * (1 - 0.6 * smooth(0.85, 1, u));
      z += spec.lingualFossa * bl * w * Math.max(0, 1 - cx * cx * 1.6) * Math.abs(cz);
    }
    const rimY = wallH + occlusalHeight(spec, cx, cz);
    const y = cejOffset(cx) * (1 - u) + u * rimY;
    return [toWorldX(cx * a, z, u), y, z];
  };

  const rings: Ring[] = [];
  const singleRoot = spec.roots.length === 0;
  const rootZone = () => "R" as ToothZone;

  if (mode !== "crown" && singleRoot) {
    // Root portion of the body for single-rooted teeth (multi-rooted root complexes are
    // built as one blended implicit surface further down).
    const depth = singleRoot ? spec.rootLen : spec.trunk;
    const steps = singleRoot ? 26 : 8;
    for (let k = steps; k >= 1; k -= 1) {
      const t = k / steps; // 1 at the apex/trunk end, 0 at the CEJ
      const pts = phis.map((_, i) => {
        const [ux, uz] = rootUnits[i];
        const [cx, cz] = units[i];
        const blend = smooth(0, 0.25, t);
        const sx = cx + (ux - cx) * blend, sz = cz + (uz - cz) * blend;
        let a: number, b0: number, b1: number;
        if (singleRoot) {
          const taper = Math.pow(1 - Math.pow(t, 2.4), 0.55) * (1 - 0.35 * t);
          a = halfMD * spec.cervMD * taper * (spec.kind === "incisor" && !isUpperTooth(tooth) ? 0.92 : 1);
          b0 = halfB * spec.cervBL * taper;
          b1 = halfL * spec.cervBL * taper;
        } else {
          const shrink = 1 - TRUNK_SHRINK * t * t;
          a = halfMD * spec.cervMD * shrink;
          b0 = halfB * spec.cervBL * shrink;
          b1 = halfL * spec.cervBL * shrink;
        }
        // Longitudinal proximal concavity (root groove) along the middle of the root.
        const groove = spec.rootGroove * Math.exp(-((sz / 0.5) ** 2)) * smooth(0.06, 0.3, t) * (1 - smooth(0.75, 1, t));
        a *= 1 - groove;
        const z = sz >= 0 ? sz * b0 : sz * b1;
        const bend = singleRoot ? -spec.rootCurve * Math.pow(t, 2.2) * mesial : 0;
        const y = -t * depth + cejOffset(cx) * Math.pow(1 - t, 3);
        return [toWorldX(sx * a, z, 0) + bend, y, z] as [number, number, number];
      });
      rings.push({ pts, zone: rootZone, level: -t });
    }
  }
  const wallSteps = Math.max(2, Math.round(22 * cutU));
  for (let k = 0; k <= wallSteps; k += 1) {
    const u = (k / wallSteps) * cutU;
    const pts = phis.map((_, i) => wallPoint(i, u));
    rings.push({
      pts,
      zone: (i) => (edgeTooth && u > 0.9 ? "O" : wallZone(units[i][0], units[i][1], mesial)),
      level: u,
    });
  }
  const capCenter: [number, number, number] = [0, 0, 0];
  if (mode === "stump") {
    const rim = rings[rings.length - 1].pts;
    const yTop = Math.max(...rim.map((p) => p[1]));
    capCenter[1] = yTop;
    for (const s of [0.82, 0.5]) {
      rings.push({ pts: rim.map(([x, , z]) => [x * s, yTop, z * s] as [number, number, number]), zone: () => "S", level: 0.5 });
    }
  } else {
    const capSteps = edgeTooth ? 16 : 34;
    for (let k = 1; k < capSteps; k += 1) {
      const s = 1 - k / capSteps;
      const stain: number[] = [];
      const pts = phis.map((_, i) => {
        const [cx, cz] = units[i];
        const a = halfMD * spec.rimMD;
        const z = cz >= 0 ? cz * halfB * spec.rimB : cz * halfL * spec.rimL;
        const y = wallH + occlusalHeight(spec, cx * s, cz * s);
        stain.push(lastStain);
        return [toWorldX(cx * a * s, z * s, 1), y, z * s] as [number, number, number];
      });
      rings.push({ pts, zone: () => "O", level: 1, stain });
    }
    capCenter[1] = wallH + occlusalHeight(spec, 0, 0);
  }

  const positions: number[] = [];
  const indices: number[] = [];
  const zones: ToothZone[] = [];
  const level: number[] = [];
  const stain: number[] = [];
  for (const ring of rings) {
    for (const p of ring.pts) positions.push(...p);
    for (let i = 0; i < ring.pts.length; i += 1) { level.push(ring.level); stain.push(ring.stain ? ring.stain[i] : 0); }
  }
  const N = SEGMENTS;
  for (let r = 0; r < rings.length - 1; r += 1) {
    const zoneRing = rings[r + 1].zone === rootZone ? rings[r + 1] : rings[r].zone === rootZone ? rings[r] : rings[r + 1];
    for (let i = 0; i < N; i += 1) {
      const j = (i + 1) % N;
      const a = r * N + i, b = r * N + j, c = (r + 1) * N + i, d = (r + 1) * N + j;
      indices.push(a, c, b, b, c, d);
      const zone = zoneRing.zone(i);
      zones.push(zone, zone);
    }
  }
  // Close the top (occlusal centre or stump) and the bottom (apex, trunk floor, or crown base).
  const topIndex = positions.length / 3;
  positions.push(...capCenter);
  level.push(mode === "stump" ? 0.5 : 1);
  stain.push(mode === "stump" ? 0 : (occlusalHeight(spec, 0, 0), lastStain));
  const lastRing = (rings.length - 1) * N;
  for (let i = 0; i < N; i += 1) {
    indices.push(lastRing + ((i + 1) % N), lastRing + i, topIndex);
    zones.push(mode === "stump" ? "S" : "O");
  }
  const bottomIndex = positions.length / 3;
  const first = rings[0].pts;
  // Multi-rooted teeth: the trunk floor arches up between the roots (furcation).
  const bottomY = mode === "crown" || !singleRoot ? 0.02 : first[0][1] - 0.025;
  const bx = first.reduce((sum, p) => sum + p[0], 0) / N;
  const bz = first.reduce((sum, p) => sum + p[2], 0) / N;
  positions.push(bx, bottomY, bz);
  level.push(mode === "crown" || !singleRoot ? 0 : -1);
  stain.push(0);
  for (let i = 0; i < N; i += 1) {
    indices.push(i, (i + 1) % N, bottomIndex);
    zones.push(mode === "crown" ? "S" : "R");
  }

  const meshes: AnatomyMesh[] = [{ positions, indices, zones, part: "body", level, stain }];
  const canals: [number, number, number][][] = [];
  let rootComplex: AnatomyMesh | null = null;
  const chamberTop = mode === "stump" ? capCenter[1] : Math.min(wallH * 0.45, 0.35);

  if (mode !== "crown") {
    if (singleRoot) {
      const canal: [number, number, number][] = [[0, chamberTop, 0]];
      for (let k = 0; k <= 10; k += 1) {
        const t = (k / 10) * 0.96;
        canal.push([-spec.rootCurve * Math.pow(t, 2.2) * mesial, -t * spec.rootLen, 0]);
      }
      canals.push(canal);
    }
    if (!singleRoot) {
      const complex = buildRootComplex(spec, mesial, halfMD, halfB, halfL, toWorldX, cejOffset);
      rootComplex = complex.mesh;
      for (const center of complex.centers) {
        const canal: [number, number, number][] = [[0, chamberTop, 0], [center(0)[0] * 0.5, chamberTop * 0.3 - spec.trunk * 0.15, center(0)[2] * 0.5]];
        for (let k = 1; k <= 8; k += 1) canal.push(center((k / 8) * 0.95));
        canals.push(canal);
      }
    }
  }
  if (mesial < 0) {
    // Mirroring x for the patient's left flips the triangle winding; restore outward faces.
    for (const mesh of meshes) for (let k = 0; k < mesh.indices.length; k += 3) {
      const swap = mesh.indices[k + 1];
      mesh.indices[k + 1] = mesh.indices[k + 2];
      mesh.indices[k + 2] = swap;
    }
  }
  if (rootComplex) meshes.push(rootComplex); // already outward-facing in world space
  return { meshes, canals };
}

type Vec3 = [number, number, number];

/** Taubin smoothing (shrink-free Laplacian) to remove marching-grid ripples. */
function smoothMesh(positions: number[], indices: number[], iterations: number): void {
  const count = positions.length / 3;
  // Unique-edge adjacency in compressed rows (much faster than per-vertex Sets).
  const edgeSeen = new Set<number>();
  const pairs: number[] = [];
  const degree = new Uint32Array(count);
  for (let k = 0; k < indices.length; k += 3) {
    for (let e = 0; e < 3; e += 1) {
      const a = indices[k + e], b = indices[k + ((e + 1) % 3)];
      const key = a < b ? a * count + b : b * count + a;
      if (edgeSeen.has(key)) continue;
      edgeSeen.add(key);
      pairs.push(a, b);
      degree[a] += 1; degree[b] += 1;
    }
  }
  const start = new Uint32Array(count + 1);
  for (let v = 0; v < count; v += 1) start[v + 1] = start[v] + degree[v];
  const fill = start.slice(0, count);
  const adj = new Uint32Array(start[count]);
  for (let p = 0; p < pairs.length; p += 2) { adj[fill[pairs[p]]++] = pairs[p + 1]; adj[fill[pairs[p + 1]]++] = pairs[p]; }
  const cur = Float64Array.from(positions);
  const next = new Float64Array(cur.length);
  const pass = (factor: number) => {
    for (let v = 0; v < count; v += 1) {
      const s0 = start[v], s1 = start[v + 1];
      const o = v * 3;
      if (s1 === s0) { next[o] = cur[o]; next[o + 1] = cur[o + 1]; next[o + 2] = cur[o + 2]; continue; }
      let mx = 0, my = 0, mz = 0;
      for (let q = s0; q < s1; q += 1) { const n = adj[q] * 3; mx += cur[n]; my += cur[n + 1]; mz += cur[n + 2]; }
      const inv = 1 / (s1 - s0);
      next[o] = cur[o] + factor * (mx * inv - cur[o]);
      next[o + 1] = cur[o + 1] + factor * (my * inv - cur[o + 1]);
      next[o + 2] = cur[o + 2] + factor * (mz * inv - cur[o + 2]);
    }
    cur.set(next);
  };
  for (let i = 0; i < iterations; i += 1) { pass(0.5); pass(-0.53); }
  for (let i = 0; i < positions.length; i += 1) positions[i] = cur[i];
}

/** Polynomial smooth minimum: blends two distance fields with a fillet of size k. */
function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

// Six tetrahedra per cube, all sharing the 0–6 diagonal so neighbouring cubes match.
const CUBE_CORNERS: Vec3[] = [[0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]];
const CUBE_TETS = [[0, 5, 1, 6], [0, 1, 2, 6], [0, 2, 3, 6], [0, 3, 7, 6], [0, 7, 4, 6], [0, 4, 5, 6]];

/**
 * Multi-rooted root complex (root trunk + individual roots) as one implicit surface:
 * the trunk and each tapering root are distance fields joined with a smooth minimum,
 * so the roots grow out of the trunk with real fillets and a rounded furcation, then
 * polygonised with marching tetrahedra. The top sits just inside the crown's cervix.
 */
function buildRootComplex(
  spec: Spec,
  mesial: number,
  halfMD: number,
  halfB: number,
  halfL: number,
  toWorldX: (nx: number, z: number, u: number) => number,
  cejOffset: (cx: number) => number,
): { mesh: AnatomyMesh; centers: ((t: number) => Vec3)[] } {
  const cervA = halfMD * spec.cervMD;
  const top = cejOffset(1) + 0.03;
  const trunkRound = 0.07;
  const roots = spec.roots.map((root) => {
    const cervB = (root.nz >= 0 ? halfB : halfL) * spec.cervBL;
    const x0 = root.nx * cervA, z0 = root.nz * cervB;
    const yTop = -spec.trunk * 0.4;
    const length = root.len - spec.trunk * 0.4;
    const bend = root.bend ?? 0;
    const center = (t: number): Vec3 => {
      // Roots diverge right after the furcation, run fairly straight, then curve apically.
      const spread = 1.6 * t - 0.6 * t * t;
      const z = z0 + root.tipZ * spread;
      return [toWorldX(x0 + root.tipX * spread + bend * Math.pow(t, 2.2), z, 0), yTop - t * length, z];
    };
    return { root, yTop, length, center, groove: root.groove ?? 0 };
  });

  // Sampling grid around the whole complex.
  let xMax = cervA + 0.08, zMax = Math.max(halfB, halfL) * spec.cervBL + 0.08, yMin = -spec.trunk - 0.05;
  for (const { root, yTop, length, center } of roots) {
    for (let k = 0; k <= 10; k += 1) {
      const [cx, , cz] = center(k / 10);
      xMax = Math.max(xMax, Math.abs(cx) + root.a + 0.08);
      zMax = Math.max(zMax, Math.abs(cz) + root.b + 0.08);
    }
    yMin = Math.min(yMin, yTop - length - 0.05);
  }
  const step = Math.min(0.036, Math.min(...spec.roots.map((r) => Math.min(r.a, r.b))) / 3.6);
  const nxs = Math.ceil((2 * xMax) / step) + 1, nys = Math.ceil((top + 0.04 - yMin) / step) + 1, nzs = Math.ceil((2 * zMax) / step) + 1;
  const px = (i: number) => -xMax + i * step, py = (j: number) => yMin + j * step, pz = (k: number) => -zMax + k * step;
  const values = new Float32Array(nxs * nys * nzs);
  const id = (i: number, j: number, k: number) => (j * nzs + k) * nxs + i;

  // Everything that depends only on the height is computed once per slice, so the
  // inner loop is just a superellipse distance plus one ellipse per root.
  const rootCount = roots.length;
  const rcx = new Float64Array(rootCount), rcz = new Float64Array(rootCount), ra = new Float64Array(rootCount), rb = new Float64Array(rootCount), rcap = new Float64Array(rootCount);
  for (let j = 0; j < nys; j += 1) {
    const y = py(j);
    const t = clamp(-y / spec.trunk);
    const scale = (1 - TRUNK_SHRINK * t * t) * 0.975;
    const n = spec.n + (2.05 - spec.n) * smooth(0, 0.25, t);
    const invN = 1 / n;
    const A = cervA * scale;
    const Bp = halfB * spec.cervBL * scale, Bn = halfL * spec.cervBL * scale;
    const q2 = -spec.trunk - y + trunkRound;
    const capTop = y - top;
    for (let r = 0; r < rootCount; r += 1) {
      const { root, yTop, length, center } = roots[r];
      const tr = clamp((yTop - y) / length, 0, 0.999);
      const taper = Math.max(0.02, Math.pow(1 - Math.pow(tr, 2.2), 0.55) * (1 - 0.3 * tr));
      const c = center(tr);
      rcx[r] = c[0]; rcz[r] = c[2];
      ra[r] = root.a * taper; rb[r] = root.b * taper;
      rcap[r] = Math.max(capTop, yTop - length - y);
    }
    for (let k = 0; k < nzs; k += 1) {
      const z = pz(k);
      const B = z >= 0 ? Bp : Bn;
      const zAbs = Math.abs(z / B);
      const zTerm = Math.pow(zAbs, n);
      const minAB = Math.min(A, B);
      const shearZ = spec.shear * z * CERVICAL_SHEAR;
      const row = (j * nzs + k) * nxs;
      // Height-only lower bound of the trunk distance (below the trunk or past its top).
      const trunkFloor = Math.max(q2 - trunkRound, capTop - 0.2);
      for (let i = 0; i < nxs; i += 1) {
        const x = px(i);
        const nx = x * mesial - shearZ;
        const cxu = nx / A;
        let d: number;
        // The superellipse norm is at least max(|x/A|, |z/B|): far from the trunk skip the pows.
        const far = (Math.max(Math.abs(cxu), zAbs) - 1) * minAB;
        if (far > 0.12 || trunkFloor > 0.12) {
          d = Math.max(far, trunkFloor);
        } else {
          const rr = Math.pow(Math.pow(Math.abs(cxu), n) + zTerm, invN);
          const q1 = (rr - 1) * minAB + trunkRound;
          d = Math.min(Math.max(q1, q2), 0) + Math.hypot(Math.max(q1, 0), Math.max(q2, 0)) - trunkRound;
        }
        // The trunk stops just under the scalloped CEJ so it never shows above the enamel.
        const capCej = y - cejOffset(cxu > 1 ? 1 : cxu < -1 ? -1 : cxu) - 0.025;
        if (capCej > d) d = capCej;
        for (let r = 0; r < rootCount; r += 1) {
          if (rcap[r] > d + 0.07) continue; // slice outside this root: no influence on smin
          const a = ra[r], b = rb[r];
          const dz = (z - rcz[r]) / b;
          const m = a < b ? a : b;
          if ((Math.abs(dz) - 1) * m > d + 0.07) continue;
          // Longitudinal groove: the root is pinched on its mesial/distal faces.
          const g = roots[r].groove;
          const pinch = g > 0 ? 1 - g * Math.exp(-dz * dz * 4) : 1;
          const dx = (x - rcx[r]) / (a * pinch);
          let dr = (Math.sqrt(dx * dx + dz * dz) - 1) * m;
          if (rcap[r] > dr) dr = rcap[r];
          d = smin(d, dr, 0.07);
        }
        values[row + i] = d;
      }
    }
  }

  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const cache = new Map<number, number>();
  const layer = nxs * nzs;
  // Field gradient at a grid node (central differences) for smooth, ripple-free shading.
  const gradient = (index: number): Vec3 => {
    const i = index % nxs, rest = (index - i) / nxs, k = rest % nzs, j = (rest - k) / nzs;
    const at = (ii: number, jj: number, kk: number) => values[id(Math.min(nxs - 1, Math.max(0, ii)), Math.min(nys - 1, Math.max(0, jj)), Math.min(nzs - 1, Math.max(0, kk)))];
    return [at(i + 1, j, k) - at(i - 1, j, k), at(i, j + 1, k) - at(i, j - 1, k), at(i, j, k + 1) - at(i, j, k - 1)];
  };
  const vertexOn = (a: number, b: number, pa: Vec3, pb: Vec3, va: number, vb: number) => {
    // Small-integer key: lower node index × 8 + which of the 7 cube diagonals/edges it is.
    const lo = a < b ? a : b, delta = (a < b ? b - a : a - b);
    const key = lo * 8 + (delta === 1 ? 0 : delta === nxs ? 1 : delta === layer ? 2 : delta === nxs + 1 ? 3 : delta === layer + 1 ? 4 : delta === layer + nxs ? 5 : 6);
    const hit = cache.get(key);
    if (hit !== undefined) return hit;
    const f = va / (va - vb);
    const index = positions.length / 3;
    positions.push(pa[0] + (pb[0] - pa[0]) * f, pa[1] + (pb[1] - pa[1]) * f, pa[2] + (pb[2] - pa[2]) * f);
    const ga = gradient(a), gb = gradient(b);
    const gx = ga[0] + (gb[0] - ga[0]) * f, gy = ga[1] + (gb[1] - ga[1]) * f, gz = ga[2] + (gb[2] - ga[2]) * f;
    const len = Math.hypot(gx, gy, gz) || 1;
    normals.push(gx / len, gy / len, gz / len);
    cache.set(key, index);
    return index;
  };
  const emit = (a: number, b: number, c: number, inside: Vec3, outside: Vec3) => {
    const p = (n: number): Vec3 => [positions[n * 3], positions[n * 3 + 1], positions[n * 3 + 2]];
    const [A, B, C] = [p(a), p(b), p(c)];
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const nrm = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const dir = [outside[0] - inside[0], outside[1] - inside[1], outside[2] - inside[2]];
    if (nrm[0] * dir[0] + nrm[1] * dir[1] + nrm[2] * dir[2] >= 0) indices.push(a, b, c);
    else indices.push(a, c, b);
  };
  const ids = new Array<number>(8), pts = new Array<Vec3>(8), vals = new Array<number>(8);
  const offsets = CUBE_CORNERS.map(([ox, oy, oz]) => oy * layer + oz * nxs + ox);
  for (let j = 0; j < nys - 1; j += 1) for (let k = 0; k < nzs - 1; k += 1) for (let i = 0; i < nxs - 1; i += 1) {
    const base = id(i, j, k);
    let inside = 0;
    for (let c = 0; c < 8; c += 1) {
      const v = values[base + offsets[c]];
      ids[c] = base + offsets[c];
      vals[c] = v;
      if (v < 0) inside += 1;
    }
    if (inside === 0 || inside === 8) continue;
    for (let c = 0; c < 8; c += 1) {
      const [ox, oy, oz] = CUBE_CORNERS[c];
      pts[c] = [px(i + ox), py(j + oy), pz(k + oz)];
    }
    for (const tet of CUBE_TETS) {
      const ins = tet.filter((c) => vals[c] < 0), outs = tet.filter((c) => vals[c] >= 0);
      if (ins.length === 0 || outs.length === 0) continue;
      const mean = (list: number[]): Vec3 => {
        const m: Vec3 = [0, 0, 0];
        for (const c of list) { m[0] += pts[c][0]; m[1] += pts[c][1]; m[2] += pts[c][2]; }
        return [m[0] / list.length, m[1] / list.length, m[2] / list.length];
      };
      const inside = mean(ins), outside = mean(outs);
      const edge = (a: number, b: number) => vertexOn(ids[a], ids[b], pts[a], pts[b], vals[a], vals[b]);
      if (ins.length === 1 || outs.length === 1) {
        const [lone, others] = ins.length === 1 ? [ins[0], outs] : [outs[0], ins];
        emit(edge(lone, others[0]), edge(lone, others[1]), edge(lone, others[2]), inside, outside);
      } else {
        const [a, b] = ins, [c, d] = outs;
        const ac = edge(a, c), ad = edge(a, d), bc = edge(b, c), bd = edge(b, d);
        emit(ac, ad, bd, inside, outside);
        emit(ac, bd, bc, inside, outside);
      }
    }
  }
  smoothMesh(positions, indices, 3);
  const zones: ToothZone[] = new Array(indices.length / 3).fill("R");
  const longest = Math.max(...roots.map((r) => r.length - r.yTop));
  const level: number[] = [];
  for (let v = 1; v < positions.length; v += 3) level.push(-clamp(-positions[v] / longest));
  const stain: number[] = new Array(level.length).fill(0);
  return { mesh: { positions, indices, zones, part: "root", level, stain, normals }, centers: roots.map((r) => r.center) };
}

export function toothAnatomySpec(tooth: number) {
  const spec = specFor(tooth);
  return { kind: spec.kind, md: spec.md, bl: spec.bl, crownH: spec.crownH, rootLen: spec.rootLen, roots: Math.max(1, spec.roots.length) };
}
