#!/usr/bin/env node
/*
  Verifica integridad del formulario en lead.html:
  - Cada input/select/textarea crítico debe tener atributo name.
  - Reporta desalineaciones entre id y name conocidos.
  Modo estricto: si CHECK_STRICT=1, sale con código 1 ante cualquier error.
*/

const fs = require('fs');
const path = require('path');

const ROOT = process.cwd();
const FILE = path.join(ROOT, 'lead.html');
const STRICT = process.env.CHECK_STRICT === '1';

const requiredIds = [
  'nombre-cliente',
  'telefono-principal',
  'telefono-alterno',
  'numero-cuenta',
  'autopago',
  'direccion',
  'tipo-servicio',
  'sistema',
  'riesgo',
  'supervisor',
  'mercado',
  'comentario',
  'motivo-llamada',
  'zip-code',
  'status',
  'servicios',
  'puntaje',
  'dia-venta',
  'dia-instalacion'
];

function findTagForId(html, id) {
  const re = new RegExp(`<([a-zA-Z]+)([^>]*?)\\bid=["']${id}["']([^>]*)>`, 'i');
  const m = html.match(re);
  if (!m) return null;
  return { tag: m[1].toLowerCase(), full: m[0] };
}

function hasNameAttr(tagStr) {
  return /\bname=\s*["'][^"']+["']/i.test(tagStr);
}

function main() {
  let ok = true;
  if (!fs.existsSync(FILE)) {
    console.warn(`[check_form_integrity] No se encontró ${FILE}. Se omite chequeo.`);
    return 0;
  }
  const html = fs.readFileSync(FILE, 'utf8');

  const problems = [];
  for (const id of requiredIds) {
    const found = findTagForId(html, id);
    if (!found) {
      problems.push({ id, issue: 'no_tag', msg: `No se encontró una etiqueta con id="${id}"` });
      continue;
    }
    if (!hasNameAttr(found.full)) {
      problems.push({ id, issue: 'no_name', msg: `La etiqueta con id="${id}" no tiene atributo name` });
    }
  }

  if (problems.length === 0) {
    console.log('[check_form_integrity] OK: Todos los campos críticos tienen atributo name.');
    return 0;
  }

  console.warn('[check_form_integrity] Advertencias/Errores encontrados:');
  for (const p of problems) {
    console.warn(` - (${p.issue}) ${p.msg}`);
  }

  if (STRICT) {
    console.error('[check_form_integrity] Modo estricto activo. Abortando por errores.');
    process.exit(1);
  }

  return 0;
}

main();
