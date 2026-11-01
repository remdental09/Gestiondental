"use client";

import { useEffect, useRef, useState } from "react";
import type { OdontogramSurface, SurfaceFinding } from "@/app/clinical-data";
import { rootCount, surfaceAxis, surfaceMarkColor, toothKind, type ToothKind } from "@/app/tooth-3d-map";

type ThreeModule = typeof import("three");

type StageProps = {
  tooth: number;
  status: string;
  surfaces: Partial<Record<OdontogramSurface, SurfaceFinding | undefined>>;
  hasCrown: boolean;
  reducedMotion: boolean;
};

function zoneOf(tooth: number, x: number, y: number, z: number): OdontogramSurface {
  const ax = Math.abs(x);
  const az = Math.abs(z);
  if (y > 0.66 && y > ax * 0.85 && y > az * 0.85) return "O";
  if (az >= ax && z >= 0) return "V";
  if (az >= ax && z < 0) return "P";
  const mesial = surfaceAxis(tooth, "M").sign;
  return x * mesial >= 0 ? "M" : "D";
}

function crownStretch(kind: ToothKind): [number, number] {
  if (kind === "incisor") return [1.2, 0.52];
  if (kind === "canine") return [0.92, 0.78];
  if (kind === "premolar") return [1.08, 0.96];
  return [1.28, 1.08];
}

export function Tooth3DStage({ tooth, status, surfaces, hasCrown, reducedMotion }: StageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");
  const surfaceKey = (["O", "V", "P", "M", "D"] as OdontogramSurface[]).map((surface) => `${surface}:${surfaces[surface]?.condition ?? ""}`).join("|");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let release = () => {};
    setError("");
    import("three").then((THREE) => {
      if (disposed) return;
      try { release = mountTooth(THREE, canvas, { tooth, status, surfaces, hasCrown, reducedMotion }); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo abrir el diente en 3D."); }
    }).catch(() => { if (!disposed) setError("No se pudo cargar la vista 3D."); });
    return () => { disposed = true; release(); };
  }, [tooth, status, surfaces, hasCrown, reducedMotion, surfaceKey]);

  return <div className="relative h-[min(52vh,420px)] min-h-64 w-full overflow-hidden rounded-xl bg-[#eef5f4]">
    <canvas ref={canvasRef} className="h-full w-full touch-none" aria-label="Diente tridimensional. Arrastra para girar." />
    {error && <p role="alert" className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-[#7a3038]">{error}</p>}
  </div>;
}

function mountTooth(THREE: ThreeModule, canvas: HTMLCanvasElement, props: StageProps): () => void {
  const { tooth, status, surfaces, hasCrown, reducedMotion } = props;
  const kind = toothKind(tooth);
  const roots = status === "Implante" || status === "Ausente" ? 0 : rootCount(tooth);
  const missing = status === "Ausente";
  const implant = status === "Implante";
  const endodontic = status === "Resto radicular con endodoncia";
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 30);
  let distance = 4.4;
  camera.position.set(0, 0.35, distance);
  scene.add(new THREE.AmbientLight(0xffffff, 0.72));
  const key = new THREE.DirectionalLight(0xffffff, 1.15);
  key.position.set(2.2, 3.4, 4);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xd7ece8, 0.45);
  fill.position.set(-2, 1, -2);
  scene.add(fill);

  const toothGroup = new THREE.Group();
  scene.add(toothGroup);
  const geometries: InstanceType<ThreeModule["BufferGeometry"]>[] = [];
  const materials: InstanceType<ThreeModule["Material"]>[] = [];
  const track = <T extends InstanceType<ThreeModule["BufferGeometry"]> | InstanceType<ThreeModule["Material"]>>(item: T): T => {
    if ("dispose" in item && item instanceof THREE.BufferGeometry) geometries.push(item);
    else materials.push(item as InstanceType<ThreeModule["Material"]>);
    return item;
  };

  const colorFor = (surface: OdontogramSurface) => new THREE.Color(surfaceMarkColor(surfaces[surface]?.condition));
  const [stretchX, stretchZ] = crownStretch(kind);
  const crown = track(new THREE.SphereGeometry(1, kind === "molar" ? 24 : 20, 14).toNonIndexed());
  crown.scale(0.56 * stretchX, kind === "incisor" ? 0.36 : kind === "canine" ? 0.5 : 0.46, 0.56 * stretchZ);
  crown.translate(0, 0.48, 0);
  crown.computeVertexNormals();
  // Non-indexed triangles receive one face color each; adjacent faces never interpolate.
  const position = crown.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index += 3) {
    const x = (position.getX(index) + position.getX(index + 1) + position.getX(index + 2)) / 3;
    const y = (position.getY(index) + position.getY(index + 1) + position.getY(index + 2)) / 3;
    const z = (position.getZ(index) + position.getZ(index + 1) + position.getZ(index + 2)) / 3;
    const color = new THREE.Color(surfaceMarkColor(surfaces[zoneOf(tooth, x, y, z)]?.condition));
    for (let vertex = index; vertex < index + 3; vertex++) {
      colors[vertex * 3] = color.r;
      colors[vertex * 3 + 1] = color.g;
      colors[vertex * 3 + 2] = color.b;
    }
  }
  crown.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  if (!missing && !implant && !endodontic) {
    toothGroup.add(new THREE.Mesh(crown, track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.04, flatShading: true, side: THREE.DoubleSide }))));
  }
  if (!missing && (hasCrown || status === "Corona")) {
    const capGeo = track(crown.clone());
    capGeo.scale(1.04, 1.03, 1.04);
    const cap = track(new THREE.MeshStandardMaterial({ color: 0xe7f4f8, metalness: 0.5, roughness: 0.28, transparent: true, opacity: 0.35 }));
    toothGroup.add(new THREE.Mesh(capGeo, cap));
  }
  if (endodontic) {
    const stumpGeo = track(new THREE.CylinderGeometry(0.3, 0.42, 0.3, 10));
    const stumpMat = track(new THREE.MeshStandardMaterial({ color: 0xdac5a8, roughness: 0.8 }));
    const stump = new THREE.Mesh(stumpGeo, stumpMat);
    stump.position.y = 0.08;
    toothGroup.add(stump);
  }
  const mesial = surfaceAxis(tooth, "M").sign;
  const rootSpots = roots === 3
    ? [[0.3 * mesial, 0.16], [-0.3 * mesial, 0.16], [0, -0.34]]
    : roots === 2
      ? [[0.34 * mesial, 0.02], [-0.34 * mesial, -0.02]]
      : roots === 1 ? [[0, 0]] : [];
  for (const [x, z] of rootSpots) {
    const height = kind === "incisor" || kind === "canine" ? 1.35 : 1.05;
    const rootGeo = track(new THREE.CylinderGeometry(0.05, kind === "molar" ? 0.16 : 0.2, height, 6));
    const rootMat = track(new THREE.MeshStandardMaterial({ color: 0xf0e2c8, roughness: 0.72, transparent: endodontic, opacity: endodontic ? 0.62 : 1 }));
    const root = new THREE.Mesh(rootGeo, rootMat);
    root.position.set(x, -height / 2 + 0.02, z);
    toothGroup.add(root);
    if (endodontic) {
      const canalGeo = track(new THREE.CylinderGeometry(0.035, 0.035, height + 0.35, 5));
      const canalMat = track(new THREE.MeshBasicMaterial({ color: 0x6d5cae }));
      const canal = new THREE.Mesh(canalGeo, canalMat);
      canal.position.set(x, -height / 2 + 0.2, z);
      toothGroup.add(canal);
    }
  }

  let releaseImplant = () => {};
  if (status === "Implante") {
    releaseImplant = buildImplant(THREE, renderer, toothGroup, track);
    // Extra light only for the titanium implant so metal never renders black.
    const hemi = new THREE.HemisphereLight(0xffffff, 0x8a9499, 0.9);
    scene.add(hemi);
    const rim = new THREE.DirectionalLight(0xffffff, 0.7);
    rim.position.set(-3, 2.5, -3.5);
    scene.add(rim);
  }

  if (missing) {
    const marker = new THREE.Mesh(track(new THREE.TorusGeometry(0.52, 0.055, 8, 32)), track(new THREE.MeshBasicMaterial({ color: 0x75858b })));
    marker.rotation.x = Math.PI / 2;
    toothGroup.add(marker);
  }
  toothGroup.rotation.x = -0.45;
  const pointers = new Map<number, { x: number; y: number }>();
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let pinch: number | null = null;

  const resize = () => {
    const width = canvas.clientWidth || 640;
    const height = canvas.clientHeight || 360;
    renderer.setSize(width, height, false);
    camera.aspect = width / Math.max(height, 1);
    camera.updateProjectionMatrix();
  };
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);

  const onPointerDown = (event: PointerEvent) => {
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    dragging = true;
    lastX = event.clientX;
    lastY = event.clientY;
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size >= 2) {
      const [first, second] = [...pointers.values()];
      const span = Math.hypot(first.x - second.x, first.y - second.y);
      if (pinch !== null) distance = Math.min(7.2, Math.max(2.4, distance * (pinch / span)));
      pinch = span;
      return;
    }
    toothGroup.rotation.y += (event.clientX - lastX) * 0.012;
    toothGroup.rotation.x = Math.min(1.1, Math.max(-1.25, toothGroup.rotation.x + (event.clientY - lastY) * 0.008));
    lastX = event.clientX;
    lastY = event.clientY;
  };
  const onPointerUp = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    dragging = pointers.size > 0;
  };
  const onWheel = (event: WheelEvent) => {
    event.preventDefault();
    distance = Math.min(7.2, Math.max(2.4, distance + event.deltaY * 0.004));
  };
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  let frame = 0;
  const draw = () => {
    frame = requestAnimationFrame(draw);
    if (!dragging && !reducedMotion) toothGroup.rotation.y += 0.01;
    camera.position.z = distance;
    camera.lookAt(0, 0.05, 0);
    renderer.render(scene, camera);
  };
  draw();

  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    canvas.removeEventListener("pointerdown", onPointerDown);
    canvas.removeEventListener("pointermove", onPointerMove);
    canvas.removeEventListener("pointerup", onPointerUp);
    canvas.removeEventListener("pointercancel", onPointerUp);
    canvas.removeEventListener("wheel", onWheel);
    geometries.forEach((geometry) => geometry.dispose());
    materials.forEach((material) => material.dispose());
    releaseImplant();
    renderer.dispose();
  };
}

type Track = <T extends InstanceType<ThreeModule["BufferGeometry"]> | InstanceType<ThreeModule["Material"]>>(item: T) => T;

/**
 * Procedural tapered screw implant (FGM Arcsys-like): polished collar with an internal
 * hex connection, conical core, one continuous helical thread with real depth that
 * tightens toward a rounded apex, and self-tapping flutes near the tip.
 * Collar top sits at y = 0 so a crown/cap above keeps its current position.
 */
function buildImplant(
  THREE: ThreeModule,
  renderer: InstanceType<ThreeModule["WebGLRenderer"]>,
  group: InstanceType<ThreeModule["Group"]>,
  track: Track,
): () => void {
  const collarHeight = 0.12;
  const bodyTop = -collarHeight;
  const apexY = -1.12;
  const topRadius = 0.32;
  const apexRadius = 0.16;
  const bodyLength = bodyTop - apexY;
  // Core radius along the body: gentle taper, faster in the apical third.
  const coreRadius = (y: number) => {
    const t = Math.min(1, Math.max(0, (bodyTop - y) / bodyLength));
    return topRadius - (topRadius - apexRadius) * Math.pow(t, 1.6) - 0.06 * t;
  };

  // Small procedural studio environment so the titanium reflects light instead of going black.
  const envScene = new THREE.Scene();
  const roomGeo = new THREE.BoxGeometry(10, 10, 10);
  const roomMat = new THREE.MeshBasicMaterial({ color: 0x9aa4aa, side: THREE.BackSide });
  envScene.add(new THREE.Mesh(roomGeo, roomMat));
  const panelGeo = new THREE.PlaneGeometry(4, 2);
  const panelMat = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const panels: [number, number, number][] = [[0, 4.5, 0], [4.5, 1, 2], [-4.5, 0, -1], [0, 1, 4.5]];
  for (const [x, y, z] of panels) {
    const panel = new THREE.Mesh(panelGeo, panelMat);
    panel.position.set(x, y, z);
    panel.lookAt(0, 0, 0);
    envScene.add(panel);
  }
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTarget = pmrem.fromScene(envScene, 0.04);
  pmrem.dispose();
  roomGeo.dispose();
  roomMat.dispose();
  panelGeo.dispose();
  panelMat.dispose();

  const titanium = track(new THREE.MeshStandardMaterial({ color: 0xb8bcc2, metalness: 0.9, roughness: 0.3, envMap: envTarget.texture, envMapIntensity: 1.1 }));
  const polished = track(new THREE.MeshStandardMaterial({ color: 0xd2d6db, metalness: 0.95, roughness: 0.14, envMap: envTarget.texture, envMapIntensity: 1.25 }));
  const flutesMat = track(new THREE.MeshStandardMaterial({ color: 0x4a5056, metalness: 0.7, roughness: 0.5, envMap: envTarget.texture, envMapIntensity: 0.6 }));
  const dark = track(new THREE.MeshStandardMaterial({ color: 0x2f3438, metalness: 0.6, roughness: 0.55, envMap: envTarget.texture, envMapIntensity: 0.4 }));

  // Polished collar with a small bevel on the platform edge.
  const collarProfile = [
    new THREE.Vector2(0.0, 0),
    new THREE.Vector2(0.27, 0),
    new THREE.Vector2(0.3, -0.015),
    new THREE.Vector2(0.31, -0.04),
    new THREE.Vector2(topRadius, -collarHeight),
  ].reverse();
  const collar = new THREE.Mesh(track(new THREE.LatheGeometry(collarProfile, 48)), polished);
  group.add(collar);

  // Internal hex connection: dark hexagonal recess plus the screw channel.
  const hex = new THREE.Mesh(track(new THREE.CylinderGeometry(0.135, 0.135, 0.02, 6)), dark);
  hex.position.y = -0.006;
  group.add(hex);
  const channel = new THREE.Mesh(track(new THREE.CylinderGeometry(0.06, 0.06, 0.022, 20)), track(new THREE.MeshBasicMaterial({ color: 0x15181a })));
  channel.position.y = -0.003;
  group.add(channel);

  // Tapered core with a rounded apex (lathe profile from collar down to the tip).
  const coreProfile: InstanceType<ThreeModule["Vector2"]>[] = [];
  const steps = 40;
  const tipStart = apexY + 0.1;
  for (let i = 0; i <= steps; i += 1) {
    const y = bodyTop - ((bodyTop - tipStart) * i) / steps;
    coreProfile.push(new THREE.Vector2(coreRadius(y), y));
  }
  const tipR = coreRadius(tipStart);
  for (let i = 1; i <= 8; i += 1) {
    const a = (i / 8) * (Math.PI / 2);
    coreProfile.push(new THREE.Vector2(Math.max(0.0001, tipR * Math.cos(a)), tipStart - 0.1 * Math.sin(a)));
  }
  coreProfile.reverse();
  group.add(new THREE.Mesh(track(new THREE.LatheGeometry(coreProfile, 48)), titanium));

  // One continuous helical thread swept with a triangular profile (real 3D depth).
  const turns = 8;
  const threadTop = bodyTop - 0.03;
  const threadBottom = apexY + 0.12;
  const segmentsPerTurn = 48;
  const samples = turns * segmentsPerTurn;
  // Normalized height progression that tightens the pitch toward the apex.
  const heightAt = (u: number) => threadTop - (threadTop - threadBottom) * (1.18 * u - 0.18 * u * u);
  const profile: [number, number][] = [[-0.012, -0.05], [0.065, -0.008], [0.065, 0.008], [-0.012, 0.05]];
  const vertices: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const u = i / samples;
    const angle = u * turns * Math.PI * 2;
    const y = heightAt(u);
    // Fade thread in/out over half a turn at each end so it blends into the core.
    const fade = Math.min(1, (u * turns) / 0.5, ((1 - u) * turns) / 0.5);
    // Finer thread toward the apex.
    const scale = 1 - 0.35 * u;
    const base = coreRadius(y);
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    for (const [radial, axial] of profile) {
      const r = base + (radial > 0 ? radial * fade * scale : radial);
      vertices.push(r * cos, y + axial * scale * Math.max(fade, 0.2), r * sin);
    }
  }
  const ring = profile.length;
  for (let i = 0; i < samples; i += 1) {
    for (let k = 0; k < ring - 1; k += 1) {
      const a = i * ring + k;
      const b = (i + 1) * ring + k;
      indices.push(a, b, a + 1, a + 1, b, b + 1);
    }
  }
  const threadGeo = track(new THREE.BufferGeometry());
  threadGeo.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  threadGeo.setIndex(indices);
  threadGeo.computeVertexNormals();
  const threadMat = track(titanium.clone());
  threadMat.side = THREE.DoubleSide;
  group.add(new THREE.Mesh(threadGeo, threadMat));

  // Self-tapping flutes: three dark grooves cut along the apical third.
  const fluteLength = 0.3;
  const fluteCenter = apexY + 0.1 + fluteLength / 2;
  const fluteGeo = track(new THREE.BoxGeometry(0.04, fluteLength, 0.07));
  for (let f = 0; f < 3; f += 1) {
    const angle = (f / 3) * Math.PI * 2 + 0.4;
    const r = coreRadius(fluteCenter) + 0.012;
    const flute = new THREE.Mesh(fluteGeo, flutesMat);
    flute.position.set(r * Math.cos(angle), fluteCenter, r * Math.sin(angle));
    flute.rotation.y = -angle;
    // Follow the taper so the groove hugs the body.
    flute.rotateZ(-Math.atan2(coreRadius(fluteCenter + 0.2) - coreRadius(fluteCenter - 0.2), 0.4));
    group.add(flute);
  }

  return () => envTarget.dispose();
}
