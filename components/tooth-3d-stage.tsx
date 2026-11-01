"use client";

import { useEffect, useRef, useState } from "react";
import type { OdontogramSurface, SurfaceFinding } from "@/app/clinical-data";
import { surfaceMarkColor } from "@/app/tooth-3d-map";
import { ANATOMY_SEGMENTS, buildToothAnatomy, type AnatomyMesh, type ToothZone } from "@/app/tooth-anatomy";

type ThreeModule = typeof import("three");
type RoomEnvironmentModule = typeof import("three/examples/jsm/environments/RoomEnvironment.js");

type StageProps = {
  tooth: number;
  status: string;
  surfaces: Partial<Record<OdontogramSurface, SurfaceFinding | undefined>>;
  hasCrown: boolean;
  reducedMotion: boolean;
  /** Optional starting orientation (radians) — used for static previews. */
  view?: { x: number; y: number };
};

type RGB = [number, number, number];

/** sRGB hex → linear RGB (the renderer works in linear space). */
function linear(hex: number): RGB {
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return [channel((hex >> 16) & 255), channel((hex >> 8) & 255), channel(hex & 255)];
}
const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const smooth = (a: number, b: number, v: number) => {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Natural tooth palette: warmer, more opaque enamel at the cervix, pinkish ivory body,
// lighter bluish translucent cusp tips / incisal edge; tan root darkening to the apex.
const ENAMEL_CERVICAL = linear(0xdcc6a2);
const ENAMEL_BODY = linear(0xe6d2c6);
const ENAMEL_TIP = linear(0xe4e4e2);
const PRIMARY_ENAMEL_BODY = linear(0xf0ebe6);
const ROOT_CERVICAL = linear(0xcfa46c);
const ROOT_APEX = linear(0x7c4c28);
const DENTINE = linear(0xd9c19a);
const FISSURE = linear(0x4e3220);
// Ceramic (zirconia/porcelain) crown: whiter, more opaque, faint grey cervically.
const CERAMIC_CERVICAL = linear(0xe0dbd2);
const CERAMIC_BODY = linear(0xf0ede7);
const CERAMIC_TIP = linear(0xf6f6f5);
const CERAMIC_FISSURE = linear(0xb7a790);

function naturalColor(level: number, stain: number, primary: boolean): RGB {
  let color: RGB;
  if (level < 0) {
    color = mix(ROOT_CERVICAL, ROOT_APEX, Math.pow(smooth(0.05, 1, -level), 0.8));
  } else {
    const body = primary ? PRIMARY_ENAMEL_BODY : ENAMEL_BODY;
    color = level < 0.5 ? mix(ENAMEL_CERVICAL, body, smooth(0.04, 0.5, level)) : mix(body, ENAMEL_TIP, smooth(0.62, 1, level));
    // Enamel thins out at the CEJ: blend into the root instead of a hard line.
    color = mix(ROOT_CERVICAL, color, smooth(0.01, 0.22, level));
  }
  return mix(color, FISSURE, Math.min(1, Math.pow(stain, 1.3) * 1.05));
}

function ceramicColor(level: number, stain: number): RGB {
  const color = level < 0.5 ? mix(CERAMIC_CERVICAL, CERAMIC_BODY, smooth(0, 0.45, level)) : mix(CERAMIC_BODY, CERAMIC_TIP, smooth(0.6, 1, level));
  return mix(color, CERAMIC_FISSURE, stain * 0.45);
}

/**
 * Tint of the odontogram finding for one surface, applied over the realistic base (kept glossy).
 * "Sin lesión visible" only gets a faint cast so a sound surface still reads as natural enamel.
 */
function findingTint(zone: ToothZone, surfaces: StageProps["surfaces"]): { color: RGB; strength: number } | null {
  if (zone === "R" || zone === "S") return null;
  const condition = surfaces[zone]?.condition;
  if (!condition || condition === "not_examined") return null;
  const hex = surfaceMarkColor(condition);
  return { color: linear(parseInt(hex.replace("#", ""), 16)), strength: condition === "sound" ? 0.28 : 0.86 };
}

/** Tileable longitudinal streak texture for the root surface (rows near v = 0 stay flat for the crown). */
function rootTexture(THREE: ThreeModule) {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const waves = Array.from({ length: 9 }, () => ({ k: 2 + Math.floor(rand() * 16), phase: rand() * Math.PI * 2, amp: 0.3 + rand(), drift: rand() * 3 }));
  const norm = waves.reduce((sum, w) => sum + w.amp, 0);
  for (let y = 0; y < size; y += 1) {
    const v = y / size;
    const ramp = smooth(0.08, 0.16, v);
    for (let x = 0; x < size; x += 1) {
      const u = x / size;
      let h = 0;
      for (const w of waves) h += w.amp * Math.sin(2 * Math.PI * w.k * u + w.phase + w.drift * Math.sin(v * 6.0 + w.phase));
      const grain = (rand() - 0.5) * 0.25;
      // Soft longitudinal striation plus low-frequency mottling (cementum), not wood grain.
      const mottle = Math.sin(2 * Math.PI * (2 * u + 0.15 * Math.sin(v * 11))) * Math.sin(v * 17 + 2 * Math.sin(2 * Math.PI * u));
      const value = 1 - ramp * (0.07 + 0.035 * (h / norm) + 0.04 * mottle + grain * 0.08);
      const o = (y * size + x) * 4;
      data[o] = data[o + 1] = data[o + 2] = Math.round(255 * Math.min(1, Math.max(0, value)));
      data[o + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Soft radial contact shadow under the tooth. */
function shadowTexture(THREE: ThreeModule) {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
    const r = Math.hypot(x / (size - 1) - 0.5, y / (size - 1) - 0.5) * 2;
    const o = (y * size + x) * 4;
    data[o] = data[o + 1] = data[o + 2] = 30;
    data[o + 3] = Math.round(255 * Math.pow(Math.max(0, 1 - r), 2.2));
  }
  const texture = new THREE.DataTexture(data, size, size);
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

/** Physical material whose gloss (roughness, clearcoat, sheen) follows a per-vertex `gloss` attribute: 1 enamel/ceramic, 0 root. */
function glossyMaterial(THREE: ThreeModule, params: ConstructorParameters<ThreeModule["MeshPhysicalMaterial"]>[0], rootRoughness: number) {
  const material = new THREE.MeshPhysicalMaterial(params);
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute float gloss;\nvarying float vGloss;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvGloss = gloss;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vGloss;")
      .replace("#include <roughnessmap_fragment>", `#include <roughnessmap_fragment>\nroughnessFactor = mix(${rootRoughness.toFixed(3)}, roughnessFactor, vGloss);`)
      .replace("material.clearcoat = clearcoat;", "material.clearcoat = clearcoat * vGloss;")
      .replace("material.sheenColor = sheenColor;", "material.sheenColor = sheenColor * vGloss;");
  };
  material.customProgramCacheKey = () => `gloss-${rootRoughness}`;
  return material;
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
    Promise.all([import("three"), import("three/examples/jsm/environments/RoomEnvironment.js")]).then(([THREE, room]) => {
      if (disposed) return;
      try { release = mountTooth(THREE, room, canvas, { tooth, status, surfaces, hasCrown, reducedMotion, view }); }
      catch (cause) { setError(cause instanceof Error ? cause.message : "No se pudo abrir el diente en 3D."); }
    }).catch(() => { if (!disposed) setError("No se pudo cargar la vista 3D."); });
    return () => { disposed = true; release(); };
  }, [tooth, status, surfaces, hasCrown, reducedMotion, surfaceKey, viewKey]);

  return <div className="relative h-[min(52vh,420px)] min-h-64 w-full overflow-hidden rounded-xl bg-[#eef5f4]">
    <canvas ref={canvasRef} className="h-full w-full touch-none" aria-label="Diente tridimensional. Arrastra para girar." />
    {error && <p role="alert" className="absolute inset-0 flex items-center justify-center p-6 text-center text-sm text-[#7a3038]">{error}</p>}
  </div>;
}

function mountTooth(THREE: ThreeModule, room: RoomEnvironmentModule, canvas: HTMLCanvasElement, props: StageProps): () => void {
  const { tooth, status, surfaces, hasCrown, reducedMotion, view } = props;
  const missing = status === "Ausente";
  const implant = status === "Implante";
  const endodontic = status === "Resto radicular con endodoncia";
  const crowned = !missing && !implant && (hasCrown || status === "Corona");
  const primary = Math.floor(tooth / 10) >= 5;
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: Boolean(view) });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const fov = 32;
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 40);

  // Studio lighting: soft image-based light from a neutral room, a warm key, a cool fill
  // and a strong rim from behind for the bright edge highlight of glossy enamel.
  const pmrem = new THREE.PMREMGenerator(renderer);
  const roomScene = new room.RoomEnvironment();
  const envTarget = pmrem.fromScene(roomScene, 0.04);
  roomScene.dispose();
  pmrem.dispose();
  scene.environment = envTarget.texture;
  scene.environmentIntensity = 0.32;
  const key = new THREE.DirectionalLight(0xfff4e8, 1.7);
  key.position.set(2.6, 3, 3);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xdfeaf2, 0.3);
  fill.position.set(-3, 0.5, 2);
  scene.add(fill);
  const rim = new THREE.DirectionalLight(0xffffff, 1.7);
  rim.position.set(-1.5, 2.5, -4);
  scene.add(rim);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x9c8a72, 0.2));

  const toothGroup = new THREE.Group();
  scene.add(toothGroup);
  const inner = new THREE.Group();
  toothGroup.add(inner);
  const geometries: InstanceType<ThreeModule["BufferGeometry"]>[] = [];
  const materials: InstanceType<ThreeModule["Material"]>[] = [];
  const textures: InstanceType<ThreeModule["Texture"]>[] = [];
  const track = <T extends InstanceType<ThreeModule["BufferGeometry"]> | InstanceType<ThreeModule["Material"]>>(item: T): T => {
    if ("dispose" in item && item instanceof THREE.BufferGeometry) geometries.push(item);
    else materials.push(item as InstanceType<ThreeModule["Material"]>);
    return item;
  };

  /**
   * Smooth per-vertex normals and base colours (gradients, fissure stain, CEJ blend), but the
   * odontogram tint is applied per triangle so the border between two surfaces stays crisp.
   * Root UVs wrap around the long axis for the longitudinal streak texture.
   */
  const toGeometry = (mesh: AnatomyMesh, colorAt: (level: number, stain: number) => RGB, glossAt: (level: number) => number, tintOf: (zone: ToothZone) => { color: RGB; strength: number } | null) => {
    let normals = mesh.normals;
    if (!normals) {
      const indexed = new THREE.BufferGeometry();
      indexed.setAttribute("position", new THREE.Float32BufferAttribute(mesh.positions, 3));
      indexed.setIndex(mesh.indices);
      indexed.computeVertexNormals();
      normals = Array.from(indexed.getAttribute("normal").array as Float32Array);
      indexed.dispose();
    }
    const vertexCount = mesh.positions.length / 3;
    const base: RGB[] = new Array(vertexCount);
    const gloss = new Float32Array(vertexCount);
    const uvAt = new Float32Array(vertexCount * 2);
    for (let v = 0; v < vertexCount; v += 1) {
      const level = mesh.level[v];
      base[v] = colorAt(level, mesh.stain[v]);
      gloss[v] = glossAt(level);
      const x = mesh.positions[v * 3], z = mesh.positions[v * 3 + 2];
      uvAt[v * 2] = (Math.atan2(z, x) / (2 * Math.PI) + 0.5) * 2;
      uvAt[v * 2 + 1] = level < 0 ? 0.16 + 0.84 * Math.min(1, -level) : 0.02;
    }
    const triangles = mesh.indices.length / 3;
    const out = {
      position: new Float32Array(triangles * 9), normal: new Float32Array(triangles * 9), color: new Float32Array(triangles * 9),
      uv: new Float32Array(triangles * 6), gloss: new Float32Array(triangles * 3),
    };
    for (let t = 0; t < triangles; t += 1) {
      const tint = tintOf(mesh.zones[t]);
      const us = [0, 1, 2].map((c) => uvAt[mesh.indices[t * 3 + c] * 2]);
      const lo = Math.min(...us);
      for (let c = 0; c < 3; c += 1) {
        const v = mesh.indices[t * 3 + c];
        const o = (t * 3 + c);
        for (let k = 0; k < 3; k += 1) {
          out.position[o * 3 + k] = mesh.positions[v * 3 + k];
          out.normal[o * 3 + k] = normals[v * 3 + k];
        }
        let color = base[v];
        if (tint) color = mix(mix(color, tint.color, tint.strength), FISSURE, mesh.stain[v] * 0.35 * tint.strength);
        out.color[o * 3] = color[0]; out.color[o * 3 + 1] = color[1]; out.color[o * 3 + 2] = color[2];
        // Unwrap the seam of the angular coordinate inside a triangle.
        out.uv[o * 2] = us[c] - lo > 1 ? us[c] - 2 : us[c];
        out.uv[o * 2 + 1] = uvAt[v * 2 + 1];
        out.gloss[o] = tint ? Math.max(gloss[v], 0.8) : gloss[v];
      }
    }
    const geometry = track(new THREE.BufferGeometry());
    geometry.setAttribute("position", new THREE.BufferAttribute(out.position, 3));
    geometry.setAttribute("normal", new THREE.BufferAttribute(out.normal, 3));
    geometry.setAttribute("color", new THREE.BufferAttribute(out.color, 3));
    geometry.setAttribute("uv", new THREE.BufferAttribute(out.uv, 2));
    geometry.setAttribute("gloss", new THREE.BufferAttribute(out.gloss, 1));
    return geometry;
  };
  const tintOf = (zone: ToothZone) => findingTint(zone, surfaces);
  const noTint = () => null;
  const naturalGloss = (level: number) => smooth(-0.02, 0.12, level);
  const ceramicMaterial = () => glossyMaterial(THREE, {
    vertexColors: true, roughness: 0.16, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.06,
    sheen: 0.2, sheenColor: new THREE.Color(0xffffff), sheenRoughness: 0.4,
  }, 0.16);

  if (!missing && !implant) {
    const anatomy = buildToothAnatomy(tooth, endodontic ? "stump" : "full");
    const texture = rootTexture(THREE);
    textures.push(texture);
    const toothMat = track(glossyMaterial(THREE, {
      vertexColors: true, roughness: 0.26, metalness: 0, clearcoat: 0.7, clearcoatRoughness: 0.14,
      sheen: 0.25, sheenColor: new THREE.Color(0xffdccc), sheenRoughness: 0.45,
      map: texture, bumpMap: texture, bumpScale: 1.2,
      transparent: endodontic, opacity: endodontic ? 0.6 : 1, depthWrite: !endodontic,
    }, 0.48));
    const colorAt = (level: number, stain: number) => (level === 0.5 && endodontic ? DENTINE : naturalColor(level, stain, primary));
    for (const mesh of anatomy.meshes) {
      const isStumpTop = (zone: ToothZone) => zone === "S";
      const geometry = toGeometry(mesh, colorAt, endodontic ? () => 0.35 : naturalGloss, (zone) => (isStumpTop(zone) ? { color: DENTINE, strength: 1 } : tintOf(zone)));
      inner.add(new THREE.Mesh(geometry, toothMat));
    }
    if (endodontic) {
      const canalMat = track(new THREE.MeshBasicMaterial({ color: 0x6d5cae }));
      for (const line of anatomy.canals) {
        const curve = new THREE.CatmullRomCurve3(line.map(([x, y, z]) => new THREE.Vector3(x, y, z)));
        const canal = new THREE.Mesh(track(new THREE.TubeGeometry(curve, 40, 0.022, 6, false)), canalMat);
        canal.renderOrder = -1;
        inner.add(canal);
      }
    }
    if (crowned) {
      // Full-coverage ceramic crown: opaque, whiter and glossier than enamel, with a visible
      // cervical margin where it meets the tooth at the CEJ.
      const crownMesh = buildToothAnatomy(tooth, "crown").meshes[0];
      const capGeo = toGeometry(crownMesh, ceramicColor, () => 1, tintOf);
      capGeo.scale(1.045, 1.03, 1.045);
      capGeo.translate(0, -0.008, 0);
      inner.add(new THREE.Mesh(capGeo, track(ceramicMaterial())));
      const margin: InstanceType<ThreeModule["Vector3"]>[] = [];
      for (let i = 0; i < ANATOMY_SEGMENTS; i += 1) {
        margin.push(new THREE.Vector3(crownMesh.positions[i * 3] * 1.05, crownMesh.positions[i * 3 + 1] * 1.03 - 0.006, crownMesh.positions[i * 3 + 2] * 1.05));
      }
      const marginGeo = track(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(margin, true), 96, 0.0075, 6, true));
      inner.add(new THREE.Mesh(marginGeo, track(new THREE.MeshStandardMaterial({ color: 0xbdb5a8, roughness: 0.35, metalness: 0 }))));
    }
  }

  let releaseImplant = () => {};
  if (implant) {
    releaseImplant = buildImplant(THREE, renderer, inner, track);
    if (hasCrown) {
      // Prosthetic ceramic crown with the anatomy of this tooth type, seated on the implant platform.
      const crownGeo = toGeometry(buildToothAnatomy(tooth, "crown").meshes[0], ceramicColor, () => 1, noTint);
      inner.add(new THREE.Mesh(crownGeo, track(ceramicMaterial())));
    }
    // Extra light only for the titanium implant so metal never renders black.
    const hemi = new THREE.HemisphereLight(0xffffff, 0x8a9499, 0.6);
    scene.add(hemi);
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

  if (!missing) {
    // Soft contact shadow on an invisible floor just below the tooth.
    const shadowTex = shadowTexture(THREE);
    textures.push(shadowTex);
    const shadow = new THREE.Mesh(
      track(new THREE.PlaneGeometry(radius * 1.5, radius * 1.5)),
      track(new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, opacity: 0.32, depthWrite: false, toneMapped: false })),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = -radius * 0.98;
    shadow.renderOrder = -2;
    scene.add(shadow);
  }

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
    textures.forEach((texture) => texture.dispose());
    envTarget.dispose();
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
