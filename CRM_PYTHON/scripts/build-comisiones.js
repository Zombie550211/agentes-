#!/usr/bin/env node
/**
 * Compila el JSX de la página de Comisiones Líneas a JS plano.
 *
 * Antes esa página cargaba React + @babel/standalone desde unpkg y compilaba el
 * JSX EN EL NAVEGADOR (`<script type="text/babel">`). Eso tenía dos costes:
 *
 *   - Obligaba a 'unsafe-eval' en la CSP. Babel genera código en runtime, así que
 *     sin esa directiva la página no arrancaba — y la directiva aplica a TODO el
 *     sitio, no solo a esta página.
 *   - ~3 MB de descarga (babel.min.js) en cada carga, para recompilar siempre lo
 *     mismo.
 *
 * Ahora el JSX vive en scripts/src/comisiones.jsx y se compila aquí, una vez, a
 * frontend/js/lineas/comisiones-app.js.
 *
 * Uso:
 *   npm install @babel/standalone@8.0.4     # si no está ya
 *   node CRM_PYTHON/scripts/build-comisiones.js
 *
 * Se fija la MISMA versión de Babel que usaba el CDN (8.0.4) para que la salida
 * sea la que el navegador venía generando, no la de una versión distinta.
 */
const fs   = require('fs');
const path = require('path');

let Babel;
try {
  Babel = require('@babel/standalone');
} catch (e) {
  console.error('Falta @babel/standalone. Instalalo con:\n  npm install @babel/standalone@8.0.4');
  process.exit(1);
}

const ROOT = path.resolve(__dirname, '..', '..');
const SRC  = path.join(ROOT, 'CRM_PYTHON', 'scripts', 'src', 'comisiones.jsx');
const OUT  = path.join(ROOT, 'frontend', 'js', 'lineas', 'comisiones-app.js');

const jsx = fs.readFileSync(SRC, 'utf8');

// preset "react" en modo classic: genera React.createElement(...), que es lo que
// esperan los bundles UMD de react/react-dom que carga la página.
const { code } = Babel.transform(jsx, {
  presets: [['react', { runtime: 'classic' }]],
  filename: path.basename(SRC),
  sourceType: 'script',
  compact: false,
});

const banner = `/* Comisiones Líneas — GENERADO, no editar a mano.
 * Fuente: CRM_PYTHON/scripts/src/comisiones.jsx
 * Regenerar: node CRM_PYTHON/scripts/build-comisiones.js
 */
`;

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, banner + code, 'utf8');
console.log(`OK  ${path.relative(ROOT, SRC)} -> ${path.relative(ROOT, OUT)}  (${code.split('\n').length} líneas)`);
