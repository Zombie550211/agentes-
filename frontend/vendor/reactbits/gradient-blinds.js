/**
 * Gradient Blinds — fondo animado en WebGL con "persianas" de degradado
 * y un spotlight que sigue el cursor.
 * Portado de https://reactbits.dev/backgrounds/gradient-blinds (React) a JS vanilla.
 * Usa la librería `ogl` (WebGL minimalista), importada como ES module desde CDN.
 *
 * Este archivo es un <script type="module">, así que expone la función
 * globalmente asignándola a window para poder llamarla desde scripts normales.
 *
 * Uso:
 *   <script type="module" src="/vendor/reactbits/gradient-blinds.js"></script>
 *   <script>
 *     window.initGradientBlinds(document.getElementById('bg'), { gradientColors: ['#ff9ffc', '#5227ff'] });
 *   </script>
 */
import { Renderer, Program, Mesh, Triangle } from 'https://cdn.jsdelivr.net/npm/ogl@1.0.11/src/index.js';

const MAX_COLORS = 8;
const hexToRGB = hex => {
  const c = hex.replace('#', '').padEnd(6, '0');
  const r = parseInt(c.slice(0, 2), 16) / 255;
  const g = parseInt(c.slice(2, 4), 16) / 255;
  const b = parseInt(c.slice(4, 6), 16) / 255;
  return [r, g, b];
};
const prepStops = stops => {
  const base = (stops && stops.length ? stops : ['#FF9FFC', '#5227FF']).slice(0, MAX_COLORS);
  if (base.length === 1) base.push(base[0]);
  while (base.length < MAX_COLORS) base.push(base[base.length - 1]);
  const arr = [];
  for (let i = 0; i < MAX_COLORS; i++) arr.push(hexToRGB(base[i]));
  const count = Math.max(2, Math.min(MAX_COLORS, (stops && stops.length) || 2));
  return { arr, count };
};

const vertex = `
attribute vec2 position;
attribute vec2 uv;
varying vec2 vUv;

void main() {
  vUv = uv;
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const fragment = `
#ifdef GL_ES
precision mediump float;
#endif

uniform vec3  iResolution;
uniform vec2  iMouse;
uniform float iTime;

uniform float uAngle;
uniform float uNoise;
uniform float uBlindCount;
uniform float uSpotlightRadius;
uniform float uSpotlightSoftness;
uniform float uSpotlightOpacity;
uniform float uMirror;
uniform float uDistort;
uniform float uShineFlip;
uniform vec3  uColor0;
uniform vec3  uColor1;
uniform vec3  uColor2;
uniform vec3  uColor3;
uniform vec3  uColor4;
uniform vec3  uColor5;
uniform vec3  uColor6;
uniform vec3  uColor7;
uniform int   uColorCount;

varying vec2 vUv;

float rand(vec2 co){
  return fract(sin(dot(co, vec2(12.9898,78.233))) * 43758.5453);
}

vec2 rotate2D(vec2 p, float a){
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c) * p;
}

vec3 getGradientColor(float t){
  float tt = clamp(t, 0.0, 1.0);
  int count = uColorCount;
  if (count < 2) count = 2;
  float scaled = tt * float(count - 1);
  float seg = floor(scaled);
  float f = fract(scaled);

  if (seg < 1.0) return mix(uColor0, uColor1, f);
  if (seg < 2.0 && count > 2) return mix(uColor1, uColor2, f);
  if (seg < 3.0 && count > 3) return mix(uColor2, uColor3, f);
  if (seg < 4.0 && count > 4) return mix(uColor3, uColor4, f);
  if (seg < 5.0 && count > 5) return mix(uColor4, uColor5, f);
  if (seg < 6.0 && count > 6) return mix(uColor5, uColor6, f);
  if (seg < 7.0 && count > 7) return mix(uColor6, uColor7, f);
  if (count > 7) return uColor7;
  if (count > 6) return uColor6;
  if (count > 5) return uColor5;
  if (count > 4) return uColor4;
  if (count > 3) return uColor3;
  if (count > 2) return uColor2;
  return uColor1;
}

void mainImage( out vec4 fragColor, in vec2 fragCoord )
{
    vec2 uv0 = fragCoord.xy / iResolution.xy;

    float aspect = iResolution.x / iResolution.y;
    vec2 p = uv0 * 2.0 - 1.0;
    p.x *= aspect;
    vec2 pr = rotate2D(p, uAngle);
    pr.x /= aspect;
    vec2 uv = pr * 0.5 + 0.5;

    vec2 uvMod = uv;
    if (uDistort > 0.0) {
      float a = uvMod.y * 6.0;
      float b = uvMod.x * 6.0;
      float w = 0.01 * uDistort;
      uvMod.x += sin(a) * w;
      uvMod.y += cos(b) * w;
    }
    float t = uvMod.x;
    if (uMirror > 0.5) {
      t = 1.0 - abs(1.0 - 2.0 * fract(t));
    }
    vec3 base = getGradientColor(t);

    vec2 offset = vec2(iMouse.x/iResolution.x, iMouse.y/iResolution.y);
  float d = length(uv0 - offset);
  float r = max(uSpotlightRadius, 1e-4);
  float dn = d / r;
  float spot = (1.0 - 2.0 * pow(dn, uSpotlightSoftness)) * uSpotlightOpacity;
  vec3 cir = vec3(spot);
  float stripe = fract(uvMod.x * max(uBlindCount, 1.0));
  if (uShineFlip > 0.5) stripe = 1.0 - stripe;
    vec3 ran = vec3(stripe);

    vec3 col = cir + base - ran;
    col += (rand(gl_FragCoord.xy + iTime) - 0.5) * uNoise;

    fragColor = vec4(col, 1.0);
}

void main() {
    vec4 color;
    mainImage(color, vUv * iResolution.xy);
    gl_FragColor = color;
}
`;

function initGradientBlinds(container, userOptions = {}) {
  const options = Object.assign(
    {
      dpr: window.devicePixelRatio || 1,
      paused: false,
      gradientColors: null,
      angle: 0,
      noise: 0.3,
      blindCount: 16,
      blindMinWidth: 60,
      mouseDampening: 0.15,
      mirrorGradient: false,
      spotlightRadius: 0.5,
      spotlightSoftness: 1,
      spotlightOpacity: 1,
      distortAmount: 0,
      shineDirection: 'left',
      mixBlendMode: 'lighten'
    },
    userOptions
  );

  container.classList.add('gradient-blinds-container');
  if (options.mixBlendMode) container.style.mixBlendMode = options.mixBlendMode;

  const renderer = new Renderer({ dpr: options.dpr, alpha: true, antialias: true });
  const gl = renderer.gl;
  const canvas = gl.canvas;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.display = 'block';
  container.appendChild(canvas);

  const { arr: colorArr, count: colorCount } = prepStops(options.gradientColors);
  const uniforms = {
    iResolution: { value: [gl.drawingBufferWidth, gl.drawingBufferHeight, 1] },
    iMouse: { value: [0, 0] },
    iTime: { value: 0 },
    uAngle: { value: (options.angle * Math.PI) / 180 },
    uNoise: { value: options.noise },
    uBlindCount: { value: Math.max(1, options.blindCount) },
    uSpotlightRadius: { value: options.spotlightRadius },
    uSpotlightSoftness: { value: options.spotlightSoftness },
    uSpotlightOpacity: { value: options.spotlightOpacity },
    uMirror: { value: options.mirrorGradient ? 1 : 0 },
    uDistort: { value: options.distortAmount },
    uShineFlip: { value: options.shineDirection === 'right' ? 1 : 0 },
    uColor0: { value: colorArr[0] },
    uColor1: { value: colorArr[1] },
    uColor2: { value: colorArr[2] },
    uColor3: { value: colorArr[3] },
    uColor4: { value: colorArr[4] },
    uColor5: { value: colorArr[5] },
    uColor6: { value: colorArr[6] },
    uColor7: { value: colorArr[7] },
    uColorCount: { value: colorCount }
  };

  const program = new Program(gl, { vertex, fragment, uniforms });
  const geometry = new Triangle(gl);
  const mesh = new Mesh(gl, { geometry, program });

  let mouseTarget = [0, 0];
  let lastTime = 0;
  let firstResize = true;

  const resize = () => {
    const rect = container.getBoundingClientRect();
    renderer.setSize(rect.width, rect.height);
    uniforms.iResolution.value = [gl.drawingBufferWidth, gl.drawingBufferHeight, 1];

    if (options.blindMinWidth && options.blindMinWidth > 0) {
      const maxByMinWidth = Math.max(1, Math.floor(rect.width / options.blindMinWidth));
      const effective = options.blindCount ? Math.min(options.blindCount, maxByMinWidth) : maxByMinWidth;
      uniforms.uBlindCount.value = Math.max(1, effective);
    } else {
      uniforms.uBlindCount.value = Math.max(1, options.blindCount);
    }

    if (firstResize) {
      firstResize = false;
      const cx = gl.drawingBufferWidth / 2;
      const cy = gl.drawingBufferHeight / 2;
      uniforms.iMouse.value = [cx, cy];
      mouseTarget = [cx, cy];
    }
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  const onPointerMove = e => {
    const rect = canvas.getBoundingClientRect();
    const scale = renderer.dpr || 1;
    const x = (e.clientX - rect.left) * scale;
    const y = (rect.height - (e.clientY - rect.top)) * scale;
    mouseTarget = [x, y];
    if (options.mouseDampening <= 0) uniforms.iMouse.value = [x, y];
  };
  canvas.addEventListener('pointermove', onPointerMove);

  let rafId;
  const loop = t => {
    rafId = requestAnimationFrame(loop);
    uniforms.iTime.value = t * 0.001;
    if (options.mouseDampening > 0) {
      if (!lastTime) lastTime = t;
      const dt = (t - lastTime) / 1000;
      lastTime = t;
      const tau = Math.max(1e-4, options.mouseDampening);
      let factor = 1 - Math.exp(-dt / tau);
      if (factor > 1) factor = 1;
      const cur = uniforms.iMouse.value;
      cur[0] += (mouseTarget[0] - cur[0]) * factor;
      cur[1] += (mouseTarget[1] - cur[1]) * factor;
    } else {
      lastTime = t;
    }
    if (!options.paused) {
      try {
        renderer.render({ scene: mesh });
      } catch (e) {
        console.error(e);
      }
    }
  };
  rafId = requestAnimationFrame(loop);

  const destroy = () => {
    if (rafId) cancelAnimationFrame(rafId);
    canvas.removeEventListener('pointermove', onPointerMove);
    ro.disconnect();
    if (canvas.parentElement === container) container.removeChild(canvas);
    if (typeof program.remove === 'function') program.remove();
    if (typeof geometry.remove === 'function') geometry.remove();
    if (typeof mesh.remove === 'function') mesh.remove();
    if (typeof renderer.destroy === 'function') renderer.destroy();
  };

  return { canvas, destroy };
}

window.initGradientBlinds = initGradientBlinds;
export { initGradientBlinds };
