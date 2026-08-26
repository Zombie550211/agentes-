#!/usr/bin/env node
/**
 * Recorre TODAS las páginas del CRM con un navegador real y recoge las
 * violaciones de CSP: las de la política activa (que bloquea) y las de la
 * candidata en modo reporte.
 *
 * Sirve para dos cosas:
 *   1. Comprobar que la CSP activa no rompe ninguna página antes de subirla.
 *   2. Medir cuánto falta para poder quitar 'unsafe-inline': lo que reporte la
 *      política candidata es exactamente el trabajo pendiente.
 *
 * Va en Node y no en Python a propósito: usa el playwright instalado global en
 * npm, así no mete una dependencia pesada en el venv del proyecto.
 *
 * Uso (con el servidor local levantado):
 *
 *   cd CRM_PYTHON
 *   TOKEN=$(../.venvlinux/bin/python -c "
 *   import asyncio,sys; sys.path.insert(0,'.')
 *   from sqlalchemy import text
 *   from database_mysql import AsyncSessionLocal
 *   from deps import make_token
 *   async def m():
 *       async with AsyncSessionLocal() as s:
 *           r=await s.execute(text('SELECT id,username,name,role,team,supervisor FROM users WHERE active=1 ORDER BY id LIMIT 1'))
 *           print(make_token(dict(r.mappings().first())))
 *   asyncio.run(m())") \
 *   NODE_PATH=$(npm root -g) node scripts/csp-audit.js
 *
 * Hace falta el TOKEN porque casi todas las páginas redirigen al login sin sesión.
 */
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const BASE = process.env.BASE || 'http://127.0.0.1:8001';
const TOKEN = process.env.TOKEN || '';
const ESPERA = Number(process.env.ESPERA || 2500);
const FRONTEND = path.resolve(__dirname, '../../frontend');

function paginas(dir = FRONTEND, acc = []) {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    const completo = path.join(dir, entrada.name);
    const rel = path.relative(FRONTEND, completo).split(path.sep).join('/');
    if (/(^|\/)(vendor|socket\.io|node_modules|fonts|images)(\/|$)/.test(rel)) continue;
    if (entrada.isDirectory()) paginas(completo, acc);
    else if (entrada.name.endsWith('.html')) acc.push('/' + rel);
  }
  return acc;
}

(async () => {
  if (!TOKEN) console.warn('AVISO: sin TOKEN, las páginas con sesión redirigirán al login.\n');

  const rutas = paginas().sort();
  console.log(`Auditando ${rutas.length} páginas en ${BASE}\n`);

  const navegador = await chromium.launch();
  const ctx = await navegador.newContext();
  if (TOKEN) {
    await ctx.addCookies([{ name: 'token', value: TOKEN,
      domain: new URL(BASE).hostname, path: '/' }]);
  }

  // El evento securitypolicyviolation es más fiable que leer la consola: trae la
  // directiva y el recurso exactos, y distingue bloqueo ("enforce") de reporte.
  await ctx.addInitScript(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', (e) => {
      window.__csp.push({
        directiva: e.effectiveDirective,
        bloqueado: e.blockedURI || '(inline)',
        disposicion: e.disposition,
        linea: e.lineNumber,
      });
    });
  });

  const pagina = await ctx.newPage();
  const violaciones = [];

  for (const ruta of rutas) {
    let halladas = [];
    try {
      await pagina.goto(BASE + ruta, { waitUntil: 'load', timeout: 25000 });
      await pagina.waitForTimeout(ESPERA);
      halladas = await pagina.evaluate(() => window.__csp || []);
    } catch (e) {
      console.log(`  !! ${ruta}: no se pudo cargar (${e.name})`);
      continue;
    }
    for (const v of halladas) violaciones.push({ ruta, ...v });
    const bloqueos = halladas.filter((v) => v.disposicion === 'enforce');
    const marca = bloqueos.length ? 'BLOQUEO' : (halladas.length ? 'reporte' : 'limpia');
    console.log(`  ${marca.padEnd(8)} ${ruta}`);
  }

  await navegador.close();

  const enforce = violaciones.filter((v) => v.disposicion === 'enforce');
  const report = violaciones.filter((v) => v.disposicion !== 'enforce');

  console.log('\n' + '='.repeat(62));
  if (enforce.length) {
    console.log(`LA CSP ACTIVA ROMPE ALGO: ${enforce.length} violaciones de bloqueo`);
    const grupos = new Map();
    for (const v of enforce) {
      const k = `${v.directiva} <- ${v.bloqueado}`;
      if (!grupos.has(k)) grupos.set(k, new Set());
      grupos.get(k).add(v.ruta);
    }
    for (const [k, rutas_] of [...grupos].sort()) {
      console.log(`  ${k}`);
      [...rutas_].slice(0, 3).forEach((r) => console.log(`      ${r}`));
    }
  } else {
    console.log('CSP ACTIVA: 0 violaciones de bloqueo — no rompe ninguna página');
  }

  if (report.length) {
    const grupos = new Map();
    for (const v of report) {
      if (!grupos.has(v.directiva)) grupos.set(v.directiva, new Set());
      grupos.get(v.directiva).add(v.bloqueado);
    }
    console.log(`\nCandidata sin 'unsafe-inline' (${report.length} avisos) — falta por migrar:`);
    for (const [d, bs] of [...grupos].sort()) {
      console.log(`  ${d}: ${[...bs].slice(0, 4).join(', ')}`);
    }
  } else {
    console.log("\nCandidata estricta: 0 avisos — se podría quitar 'unsafe-inline'");
  }

  process.exit(enforce.length ? 1 : 0);
})();
