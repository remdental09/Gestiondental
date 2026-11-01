"use client";

import { useEffect, useRef, useState } from "react";
import type { OdontogramSurface, SurfaceFinding } from "@/app/clinical-data";
import { surfaceMarkColor } from "@/app/tooth-3d-map";
import { buildToothAnatomy, type AnatomyMesh, type ToothZone } from "@/app/tooth-anatomy";

type ThreeModule = typeof import("three");

type StageProps = {
  tooth: number;
  status: string;
  surfaces: Partial<Record<OdontogramSurface, SurfaceFinding | undefined>>;
  hasCrown: boolean;
  reducedMotion: boolean;
  /** Optional starting orientation (radians) — used for static previews. */
  view?: { x: number; y: number };
};

const ENAMEL = 0xf1ece0;
const PRIMARY_ENAMEL = 0xf8f6f1;
const ROOT = 0xe3d3b0;
const DENTINE = 0xdac5a8;

/** Colour of one triangle: crown faces take the odontogram finding, roots stay root-coloured. */
function zoneColor(zone: ToothZone, surfaces: StageProps["surfaces"], enamel: number): string | number {
  if (zone === "R") return ROOT;
  if (zone === "S") return DENTINE;
  const condition = surfaces[zone]?.condition;
  return condition && condition !== "not_examined" ? surfaceMarkColor(condition) : enamel;
}

export function Tooth3DStage({ tooth, status, surfaces, hasCrown, reducedMotion, view }: StageProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState("");
  const surfaceKey = (["O", "V", "P", "M", "D"] as OdontogramSurface[]).map((surface) => `${surface}:${surfaces[surface]?.condition ?? ""}`).join("|");
  const viewKey = view ? `${view.x},${view.y}` : "";

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let disposed = false;
    let release = () => {};
    setError("");
    import("three").then((THREE) => {
      if (disposed) return;
      try { release = mountTooth(THREE, canvas, { tooth, status, surfaces, hasCrown, reducedMotion, view }); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo abrir el diente en 3D."); }
    }).catch(() => { if (!disposed) setError("No se pudo cargar la vista 3D."); });
    return () => { disposed = true; release(); };
  }, [tooth, status, surfaces, hasCrown, reducedMotion, surfaceKey, viewKey]);

  return <div className="relative h-[min(52vh,420px)] min-h-64 w-full overflow-hidden rounded-xl bg-[#eef5f4]">
    <canvas ref={canvasRef} className="h-full w-full touch-none" aria-label="Diente tridimensional. Arrastra para girar." />
    {error && <p role="alert" className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-[#7a3038]">{error}</p>}
  </div>;
}

function mountTooth(THREE: ThreeModule, canvas: HTMLCanvasElement, props: StageProps): () => void {
  const { tooth, status, surfaces, hasCrown, reducedMotion, view } = props;
  const missing = status === "Ausente";
  const implant = status === "Implante";
  const endodontic = status === "Resto radicular con endodoncia";
  const primary = Math.floor(tooth / 10) >= 5;
  const enamel = primary ? PRIMARY_ENAMEL : ENAMEL;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: Boolean(view) });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  const fov = 32;
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 40);
  scene.add(new THREE.AmbientLight(0xffffff, 0.5));
  scene.add(new THREE.HemisphereLight(0xffffff, 0xb8aa94, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 1.25);
  key.position.set(1.8, 2.2, 4.5);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xd7ece8, 0.5);
  fill.position.set(-2.6, 0.6, 1.5);
  scene.add(fill);
  const back = new THREE.DirectionalLight(0xffffff, 0.45);
  back.position.set(-1, 2, -3);
  scene.add(back);
  // Soft fill from below-front so surfaces tilted away from the key (e.g. the labial
  // face in an incisal view) keep readable form instead of going muddy grey.
  const under = new THREE.DirectionalLight(0xfff8ee, 0.35);
  under.position.set(0.4, -2.5, 2.5);
  scene.add(under);

  const toothGroup = new THREE.Group();
  scene.add(toothGroup);
  const inner = new THREE.Group();
  toothGroup.add(inner);
  const geometries: InstanceType<ThreeModule["BufferGeometry"]>[] = [];
  const materials: InstanceType<ThreeModule["Material"]>[] = [];
  const track = <T extends InstanceType<ThreeModule["BufferGeometry"]> | InstanceType<ThreeModule["Material"]>>(item: T): T => {
    if ("dispose" in item && item instanceof THREE.BufferGeometry) geometries.push(item);
    else materials.push(item as InstanceType<ThreeModule["Material"]>);
    return item;
  };

  /** Smooth normals from the indexed surface, then one flat colour per triangle so face borders stay crisp. */
  const toGeometry = (mesh: AnatomyMesh, colorOf: (zone: ToothZone) => string | number) => {
    const indexed = new THREE.BufferGeometry();
    indexed.setAttribute("position", new THREE.Float32BufferAttribute(mesh.positions, 3));
    indexed.setIndex(mesh.indices);
    indexed.computeVertexNormals();
    const geometry = track(indexed.toNonIndexed());
    indexed.dispose();
    const colors = new Float32Array(geometry.getAttribute("position").count * 3);
    const color = new THREE.Color();
    mesh.zones.forEach((zone, triangle) => {
      color.set(colorOf(zone));
      for (let vertex = triangle * 3; vertex < triangle * 3 + 3; vertex += 1) {
        colors[vertex * 3] = color.r;
        colors[vertex * 3 + 1] = color.g;
        colors[vertex * 3 + 2] = color.b;
      }
    });
    geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    return geometry;
  };
  const toothColor = (zone: ToothZone) => zoneColor(zone, surfaces, enamel);

  if (!missing && !implant) {
    const anatomy = buildToothAnatomy(tooth, endodontic ? "stump" : "full");
    const enamelMat = track(new THREE.MeshPhysicalMaterial({
      vertexColors: true, roughness: 0.42, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.35,
      transparent: endodontic, opacity: endodontic ? 0.6 : 1, depthWrite: !endodontic,
    }));
    const rootMat = track(new THREE.MeshStandardMaterial({
      vertexColors: true, roughness: 0.7, metalness: 0,
      transparent: endodontic, opacity: endodontic ? 0.6 : 1, depthWrite: !endodontic,
    }));
    for (const mesh of anatomy.meshes) inner.add(new THREE.Mesh(toGeometry(mesh, toothColor), mesh.part === "body" ? enamelMat : rootMat));
    if (endodontic) {
      const canalMat = track(new THREE.MeshBasicMaterial({ color: 0x6d5cae }));
      for (const line of anatomy.canals) {
        const curve = new THREE.CatmullRomCurve3(line.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
        const canal = new THREE.Mesh(track(new THREE.TubeGeometry(curve, 40, 0.022, 6, false)), canalMat);
        canal.renderOrder = -1;
        inner.add(canal);
      }
    }
    if (hasCrown || status === "Corona") {
      const capGeo = toGeometry(buildToothAnatomy(tooth, "crown").meshes[0], () => 0xffffff);
      capGeo.deleteAttribute("color");
      capGeo.scale(1.05, 1.03, 1.05);
      capGeo.translate(0, -0.006, 0);
      const cap = track(new THREE.MeshStandardMaterial({ color: 0xe7f4f8, metalness: 0.5, roughness: 0.28, transparent: true, opacity: 0.38, depthWrite: false }));
      inner.add(new THREE.Mesh(capGeo, cap));
    }
  }

  let releaseImplant = () => {};
  if (implant) {
    releaseImplant = buildImplant(THREE, renderer, inner, track);
    if (hasCrown) {
      // Prosthetic crown with the anatomy of this tooth type, seated on the implant platform.
      const crownGeo = toGeometry(buildToothAnatomy(tooth, "crown").meshes[0], () => 0xf6f3ec);
      const porcelain = track(new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.3, metalness: 0, clearcoat: 0.6, clearcoatRoughness: 0.2 }));
      inner.add(new THREE.Mesh(crownGeo, porcelain));
    }
    // Extra light only for the titanium implant so metal never renders black.
    const hemi = new THREE.HemisphereLight(0xffffff, 0x8a9499, 0.6);
    scene.add(hemi);
    const rim = new THREE.DirectionalLight(0xffffff, 0.7);
    rim.position.set(-3, 2.5, -3.5);
    scene.add(rim);
  }

  if (missing) {
    const marker = new THREE.Mesh(track(new THREE.TorusGeometry(0.52, 0.055, 8, 32)), track(new THREE.MeshBasicMaterial({ color: 0x75858b })));
    marker.rotation.x = Math.PI / 2;
    inner.add(marker);
  }

  // Frame the whole tooth, roots included: centre it on the rotation pivot and back the camera off to fit.
  const bounds = new THREE.Box3().setFromObject(inner);
  const size = bounds.getSize(new THREE.Vector3());
  const middle = bounds.getCenter(new THREE.Vector3());
  inner.position.set(-middle.x, -middle.y, -middle.z);
  const radius = 0.5 * Math.hypot(size.y, Math.max(size.x, size.z)) * 1.06;
  const fitDistance = Math.max(2.6, radius / Math.sin(((fov / 2) * Math.PI) / 180));
  const minDistance = fitDistance * 0.45;
  const maxDistance = fitDistance * 1.7;
  let distance = fitDistance;
  camera.position.set(0, 0, distance);

  toothGroup.rotation.x = view ? view.x : -0.3;
  toothGroup.rotation.y = view ? view.y : 0;
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
      if (pinch !== null) distance = Math.min(maxDistance, Math.max(minDistance, distance * (pinch / span)));
      pinch = span;
      return;
    }
    toothGroup.rotation.y += (event.clientX - lastX) * 0.012;
    toothGroup.rotation.x = Math.min(1.55, Math.max(-1.25, toothGroup.rotation.x + (event.clientY - lastY) * 0.008));
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
    distance = Math.min(maxDistance, Math.max(minDistance, distance + event.deltaY * 0.004 * (fitDistance / 4.4)));
  };
  canvas.addEventListener("pointerdown", onPointerDown);
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  let frame = 0;
  const draw = () => {
    frame = requestAnimationFrame(draw);
    if (view && !dragging) { renderer.render(scene, camera); return; }
    if (!dragging && !reducedMotion) toothGroup.rotation.y += 0.01;
    camera.position.set(0, distance * 0.06, distance);
    camera.lookAt(0, 0, 0);
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
