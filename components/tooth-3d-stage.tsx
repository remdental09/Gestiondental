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
  const ay = Math.abs(y);
  const az = Math.abs(z);
  if (y > 0.15 && ay >= ax * 0.85 && ay >= az * 0.85) return "O";
  if (az >= ax && z >= 0) return "V";
  if (az >= ax && z < 0) return "P";
  const mesial = surfaceAxis(tooth, "M").sign;
  return x * mesial >= 0 ? "M" : "D";
}

function profile(kind: ToothKind): Array<[number, number]> {
  if (kind === "incisor") return [[0, 0.46], [0.28, 0.52], [0.78, 0.4], [1.12, 0.06]];
  if (kind === "canine") return [[0, 0.42], [0.34, 0.55], [0.86, 0.26], [1.22, 0.02]];
  if (kind === "premolar") return [[0, 0.5], [0.26, 0.62], [0.68, 0.52], [0.96, 0.2]];
  return [[0, 0.58], [0.24, 0.78], [0.58, 0.7], [0.92, 0.28]];
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
  const roots = status === "Implante" ? 0 : rootCount(tooth);
  const missing = status === "Ausente" || status === "Indicación de exodoncia";
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
  const points = profile(kind).map(([y, radius]) => new THREE.Vector2(radius, y));
  const crown = track(new THREE.LatheGeometry(points, kind === "molar" ? 10 : 8));
  crown.scale(stretchX, 1, stretchZ);
  crown.computeVertexNormals();
  const position = crown.getAttribute("position");
  const colors = new Float32Array(position.count * 3);
  const scratch = new THREE.Color();
  for (let index = 0; index < position.count; index += 1) {
    const zone = zoneOf(tooth, position.getX(index), position.getY(index), position.getZ(index));
    scratch.copy(colorFor(zone));
    colors[index * 3] = scratch.r;
    colors[index * 3 + 1] = scratch.g;
    colors[index * 3 + 2] = scratch.b;
  }
  crown.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  const enamel = track(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.04 }));
  toothGroup.add(new THREE.Mesh(crown, enamel));

  if (hasCrown || status === "Corona") {
    const capGeo = track(crown.clone());
    capGeo.scale(1.04, 1.03, 1.04);
    const cap = track(new THREE.MeshStandardMaterial({ color: 0xe7f4f8, metalness: 0.72, roughness: 0.18, transparent: true, opacity: missing ? 0.28 : 0.42 }));
    toothGroup.add(new THREE.Mesh(capGeo, cap));
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

  if (status === "Implante") {
    const metal = track(new THREE.MeshStandardMaterial({ color: 0xb7c3c6, metalness: 0.86, roughness: 0.28 }));
    for (let step = 0; step < 7; step += 1) {
      const radius = step % 2 === 0 ? 0.22 : 0.16;
      const disk = track(new THREE.CylinderGeometry(radius, radius, 0.12, 8));
      const mesh = new THREE.Mesh(disk, metal);
      mesh.position.y = -0.12 - step * 0.13;
      toothGroup.add(mesh);
    }
    const tip = track(new THREE.ConeGeometry(0.12, 0.28, 8));
    const tipMesh = new THREE.Mesh(tip, metal);
    tipMesh.position.y = -1.16;
    tipMesh.rotation.x = Math.PI;
    toothGroup.add(tipMesh);
  }

  if (missing) {
    toothGroup.traverse((node) => {
      const mesh = node as InstanceType<ThreeModule["Mesh"]>;
      const material = mesh.material as InstanceType<ThreeModule["Material"]> | undefined;
      if (!material || !("opacity" in material)) return;
      material.transparent = true;
      material.opacity = Math.min(material.opacity, 0.28);
    });
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
    if (!dragging && !reducedMotion) toothGroup.rotation.y += 0.004;
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
    renderer.dispose();
  };
}
