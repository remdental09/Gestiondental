"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { buildToothAnatomy, type AnatomyMesh } from "@/app/tooth-anatomy";

const UPPER = [18,17,16,15,14,13,12,11,21,22,23,24,25,26,27,28];
const LOWER = [48,47,46,45,44,43,42,41,31,32,33,34,35,36,37,38];

function meshFrom(anatomy: AnatomyMesh, material: THREE.Material) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(anatomy.positions, 3));
  geometry.setIndex(anatomy.indices);
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, material);
}

export function FullArch3DStage({ reducedMotion }: { reducedMotion: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = host.current; if (!el) return;
    const scene = new THREE.Scene(); scene.background = new THREE.Color("#f8f5f1");
    const camera = new THREE.PerspectiveCamera(32, 1, .1, 100); camera.position.set(0, 1, 18);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; el.appendChild(renderer.domElement);
    scene.add(new THREE.HemisphereLight(0xfff8ef, 0x806950, 2));
    const key = new THREE.DirectionalLight(0xffffff, 3); key.position.set(-5, 8, 9); scene.add(key);
    const fill = new THREE.DirectionalLight(0xffd9c6, 1.2); fill.position.set(6, 1, -4); scene.add(fill);
    const arch = new THREE.Group(); scene.add(arch);
    const poreCanvas = document.createElement("canvas"); poreCanvas.width = poreCanvas.height = 512;
    const ctx = poreCanvas.getContext("2d")!; ctx.fillStyle="#ead9b9";ctx.fillRect(0,0,512,512);
    let seed=27;const rand=()=>((seed=(seed*16807)%2147483647)/2147483647);
    for(let i=0;i<900;i++){const x=rand()*512,y=rand()*512,r=2+rand()*9;ctx.beginPath();ctx.ellipse(x,y,r,r*(.6+rand()),0,0,Math.PI*2);ctx.fillStyle=i%3?"#bda47e":"#f7eddc";ctx.fill();}
    for(let i=0;i<170;i++){ctx.beginPath();ctx.moveTo(rand()*512,rand()*512);ctx.lineTo(rand()*512,rand()*512);ctx.strokeStyle="rgba(255,247,225,.75)";ctx.lineWidth=1+rand()*3;ctx.stroke();}
    const pores=new THREE.CanvasTexture(poreCanvas); pores.colorSpace=THREE.SRGBColorSpace;
    const boneMat=new THREE.MeshStandardMaterial({color:0xffffff,map:pores,bumpMap:pores,bumpScale:.16,roughness:.88,transparent:true,opacity:.74,side:THREE.DoubleSide,depthWrite:false});
    const ligamentMat=new THREE.MeshStandardMaterial({color:0xc96d73,roughness:.55,transparent:true,opacity:.78,side:THREE.DoubleSide,depthWrite:false});
    const toothMat=new THREE.MeshPhysicalMaterial({color:0xf2e5d4,roughness:.22,clearcoat:.7});
    const place=(numbers:number[], upper:boolean)=>{
      numbers.forEach((n,i)=>{
        const x=(i-7.5)*.48, z=1.8-.075*x*x, y=upper?1.35:-1.35;
        const tooth=new THREE.Group(); tooth.position.set(x,y,z); tooth.scale.setScalar(.78);
        if(upper) tooth.rotation.z=Math.PI;
        const anatomy=buildToothAnatomy(n,"full");
        for(const part of anatomy.meshes){const m=meshFrom(part,toothMat);tooth.add(m);
          if(part.part==="root"){
            const pdl=meshFrom(part,ligamentMat);pdl.scale.setScalar(1.045);pdl.position.y=upper?-.015:.015;pdl.renderOrder=2;tooth.add(pdl);
          }
        }
        arch.add(tooth);
        // Porous alveolar bone around the root zone; adjacent sockets visually join as an arch.
        const bone=new THREE.Mesh(new THREE.SphereGeometry(1,24,18),boneMat);
        bone.position.set(x,upper?2.05:-2.05,z-.04);bone.scale.set(.37,.95,.53);arch.add(bone);
      });
    };
    place(UPPER,true);place(LOWER,false);
    // Connect the individual cancellous sockets into continuous alveolar ridges.
    for(const upper of [true,false]) for(const side of [-1,1]){
      const curve=new THREE.CatmullRomCurve3(Array.from({length:18},(_,j)=>{const x=side*(.15+j*.22);return new THREE.Vector3(x,upper?2.03:-2.03,1.65-.075*x*x);}));
      const ridge=new THREE.Mesh(new THREE.TubeGeometry(curve,60,.31,12,false),boneMat);ridge.scale.set(1,1,.78);arch.add(ridge);
    }
    let down=false, lastX=0,lastY=0; const pointer=(e:PointerEvent)=>{if(down){arch.rotation.y+=(e.clientX-lastX)*.008;arch.rotation.x+=(e.clientY-lastY)*.008;}lastX=e.clientX;lastY=e.clientY;};
    const start=(e:PointerEvent)=>{down=true;renderer.domElement.setPointerCapture(e.pointerId);lastX=e.clientX;lastY=e.clientY;};
    const end=()=>{down=false;};renderer.domElement.addEventListener("pointerdown",start);renderer.domElement.addEventListener("pointermove",pointer);renderer.domElement.addEventListener("pointerup",end);renderer.domElement.addEventListener("pointercancel",end);
    const wheel=(e:WheelEvent)=>{camera.position.z=THREE.MathUtils.clamp(camera.position.z+e.deltaY*.008,8,28);};renderer.domElement.addEventListener("wheel",wheel,{passive:true});
    let frame=0;const render=()=>{if(!reducedMotion&&!down)arch.rotation.y+=.0025;renderer.render(scene,camera);frame=requestAnimationFrame(render);};render();
    const resize=()=>{const w=el.clientWidth,h=el.clientHeight;renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();};const observer=new ResizeObserver(resize);observer.observe(el);resize();
    return()=>{cancelAnimationFrame(frame);observer.disconnect();renderer.domElement.removeEventListener("pointerdown",start);renderer.domElement.removeEventListener("pointermove",pointer);renderer.domElement.removeEventListener("pointerup",end);renderer.domElement.removeEventListener("pointercancel",end);renderer.domElement.removeEventListener("wheel",wheel);scene.traverse(o=>{if(o instanceof THREE.Mesh){o.geometry.dispose();const mats=Array.isArray(o.material)?o.material:[o.material];mats.forEach(m=>m.dispose());}});pores.dispose();renderer.dispose();renderer.domElement.remove();};
  },[reducedMotion]);
  return <div ref={host} className="h-[min(58vh,480px)] min-h-72 w-full overflow-hidden rounded-xl border border-[#e8ddd2]" role="img" aria-label="Vista 3D de ambas arcadas con hueso alveolar trabecular translúcido y ligamento periodontal" />;
}
