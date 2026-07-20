/**
 * Rueda de la fortuna wireframe en 3D real (Three.js), para el fondo del login.
 * Se importa como ES module desde CDN — no hay build step ni npm en este
 * proyecto, así que Three.js se resuelve directo en el navegador.
 */
import * as THREE from 'https://unpkg.com/three@0.184.0/build/three.module.js';

function initLoginWheel3D(canvas) {
  if (!canvas) return null;

  const width = canvas.clientWidth || 680;
  const height = canvas.clientHeight || 680;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(width, height, false);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 100);
  camera.position.set(0, 0.5, 9);
  camera.lookAt(0, 0.3, 0);

  const TILT = -0.22;

  // ── Base / torres de soporte (para que la rueda no quede flotando) ──
  const support = new THREE.Group();
  support.rotation.x = TILT;
  scene.add(support);
  const legMat = new THREE.MeshBasicMaterial({ color: 0x5a76c9, transparent: true, opacity: 0.55 });
  function addLeg(x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const len = Math.hypot(dx, dy);
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, len, 6), legMat);
    mesh.position.set((x1 + x2) / 2, (y1 + y2) / 2, 0);
    mesh.rotation.z = Math.atan2(-dx, dy);
    support.add(mesh);
  }
  const topL = [-1.05, -1.85], botL = [-1.85, -3.5];
  const topR = [1.05, -1.85], botR = [1.85, -3.5];
  addLeg(topL[0], topL[1], botL[0], botL[1]);
  addLeg(topR[0], topR[1], botR[0], botR[1]);
  addLeg(botL[0], botL[1], botR[0], botR[1]);           // barra de base
  addLeg(topL[0], topL[1], botR[0], botR[1]);            // cruz diagonal
  addLeg(topR[0], topR[1], botL[0], botL[1]);            // cruz diagonal
  addLeg(0, -1.4, botL[0] * 0.55, botL[1] * 0.55);        // riostra corta central-izq
  addLeg(0, -1.4, botR[0] * 0.55, botR[1] * 0.55);        // riostra corta central-der

  const wheel = new THREE.Group();
  wheel.rotation.x = TILT;
  scene.add(wheel);

  const palette = [0x00e5ff, 0xff2d95, 0xffb200, 0x39ff88];
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(2.4, 0.05, 10, 64), new THREE.MeshBasicMaterial({ color: 0x00e5ff, wireframe: true })));
  wheel.add(new THREE.Mesh(new THREE.TorusGeometry(2.55, 0.012, 6, 64), new THREE.MeshBasicMaterial({ color: 0x00e5ff, transparent: true, opacity: 0.4 })));
  wheel.add(new THREE.Mesh(new THREE.SphereGeometry(0.28, 16, 16), new THREE.MeshBasicMaterial({ color: 0xffb200, wireframe: true })));

  const cabins = [];
  const N = 14;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const color = palette[i % palette.length];
    const spoke = new THREE.Mesh(
      new THREE.CylinderGeometry(0.015, 0.015, 2.4, 6),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55 })
    );
    spoke.position.set(Math.cos(a) * 1.2, Math.sin(a) * 1.2, 0);
    spoke.rotation.z = a + Math.PI / 2;
    wheel.add(spoke);

    const pivot = new THREE.Group();
    pivot.position.set(Math.cos(a) * 2.4, Math.sin(a) * 2.4, 0);
    wheel.add(pivot);
    pivot.add(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.3), new THREE.MeshBasicMaterial({ color, wireframe: true })));
    pivot.add(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.38, 0.28), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.12 })));
    cabins.push(pivot);
  }

  let raf = null;
  const animate = () => {
    wheel.rotation.z += 0.0032;
    cabins.forEach(p => { p.rotation.z = -wheel.rotation.z; });
    renderer.render(scene, camera);
    raf = requestAnimationFrame(animate);
  };
  animate();

  const onResize = () => {
    const w = canvas.clientWidth || width, h = canvas.clientHeight || height;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  window.addEventListener('resize', onResize);

  const destroy = () => {
    cancelAnimationFrame(raf);
    window.removeEventListener('resize', onResize);
    renderer.dispose();
  };

  return { renderer, scene, camera, destroy };
}

window.initLoginWheel3D = initLoginWheel3D;

document.addEventListener('DOMContentLoaded', () => {
  const canvas = document.getElementById('ferrisWheelCanvas');
  if (!canvas) return;
  try {
    initLoginWheel3D(canvas);
  } catch (e) {
    console.warn('[login] Rueda 3D no disponible (sin WebGL?):', e);
  }
});

export { initLoginWheel3D };
