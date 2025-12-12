#!/usr/bin/env node

/**
 * Script de Validación: 3 KPIs Nuevos en Costumer.html
 * Verifica que se hayan agregado correctamente:
 * 1. Puntaje Mensual (restando canceladas)
 * 2. VENTAS ICON
 * 3. VENTAS BAMO
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'Costumer.html');

if (!fs.existsSync(filePath)) {
  console.error('❌ Archivo no encontrado:', filePath);
  process.exit(1);
}

const content = fs.readFileSync(filePath, 'utf-8');
let passed = 0;
let failed = 0;

const check = (condition, message) => {
  if (condition) {
    console.log(`✓ [PASS] ${message}`);
    passed++;
  } else {
    console.log(`✗ [FAIL] ${message}`);
    failed++;
  }
};

console.log('\n🔍 Validando 3 KPIs nuevos en Costumer.html\n');

// 1. Verificar tarjetas HTML
check(content.includes('id="costumer-puntaje-mensual"'), 'HTML: Puntaje Mensual (id)');
check(content.includes('id="costumer-icon-ventas"'), 'HTML: ICON Ventas (id)');
check(content.includes('id="costumer-bamo-ventas"'), 'HTML: BAMO Ventas (id)');

// 2. Verificar detalles/porcentajes
check(content.includes('id="costumer-icon-percent"'), 'HTML: ICON Porcentaje (id)');
check(content.includes('id="costumer-bamo-percent"'), 'HTML: BAMO Porcentaje (id)');

// 3. Verificar títulos de tarjetas
check(content.includes('Puntaje Mensual'), 'HTML: Título "Puntaje Mensual"');
check(content.includes('ICON (Mercado)'), 'HTML: Título "ICON (Mercado)"');
check(content.includes('BAMO (Mercado)'), 'HTML: Título "BAMO (Mercado)"');

// 4. Verificar clases CSS
check(content.includes('.points-monthly'), 'CSS: Clase .points-monthly');
check(content.includes('.icon-market .card-icon'), 'CSS: Clase .icon-market .card-icon');
check(content.includes('.bamo-market .card-icon'), 'CSS: Clase .bamo-market .card-icon');

// 5. Verificar gradientes CSS
check(content.includes('#43e97b') && content.includes('#38f9d7'), 'CSS: Gradiente Puntaje Mensual (verde-cyan)');
check(content.includes('#667eea') && content.includes('#764ba2'), 'CSS: Gradiente ICON (púrpura)');
check(content.includes('#f093fb') && content.includes('#f5576c'), 'CSS: Gradiente BAMO (rosa-rojo)');

// 6. Verificar función de cálculo
check(content.includes('puntajeMensual = leads.filter'), 'JS: Cálculo de puntajeMensual');
check(content.includes('iconVentas = leads.filter'), 'JS: Cálculo de iconVentas');
check(content.includes('bamoVentas = leads.filter'), 'JS: Cálculo de bamoVentas');

// 7. Verificar filtros
check(content.includes("mercado === 'ICON'") || content.includes("mercado === 'icon'"), 'JS: Filtro ICON (case-insensitive)');
check(content.includes("mercado === 'BAMO'") || content.includes("mercado === 'bamo'"), 'JS: Filtro BAMO (case-insensitive)');

// 8. Verificar exclusión de canceladas
check(content.includes('isCancel') && content.includes('!isCancel'), 'JS: Exclusión de canceladas');

// 9. Verificar cálculo de porcentajes
check(content.includes('iconPercent = totalMercados'), 'JS: Cálculo de iconPercent');
check(content.includes('bamoPercent = totalMercados'), 'JS: Cálculo de bamoPercent');

// 10. Verificar actualización del DOM
check(content.includes('puntajeMensualEl.textContent'), 'JS: Actualización DOM puntajeMensual');
check(content.includes('iconVentasEl.textContent'), 'JS: Actualización DOM iconVentas');
check(content.includes('bamoVentasEl.textContent'), 'JS: Actualización DOM bamoVentas');
check(content.includes('iconPercentEl.textContent'), 'JS: Actualización DOM iconPercent');
check(content.includes('bamoPercentEl.textContent'), 'JS: Actualización DOM bamoPercent');

// 11. Verificar logs en consola
check(content.includes('[KPI]'), 'JS: Log con prefijo [KPI]');

// 12. Verificar error handling
check(content.includes('catch (err)'), 'JS: Error handling implementado');

// 13. Verificar iconos
check(content.includes('fa-star'), 'HTML: Icono star para Puntaje');
check(content.includes('fa-map-marker-alt'), 'HTML: Icono marker para ICON');
check(content.includes('fa-bullseye'), 'HTML: Icono bullseye para BAMO');

// 14. Verificar que NO esté en Ranking y Promociones
const rankingPath = path.join(__dirname, 'Ranking y Promociones.html');
if (fs.existsSync(rankingPath)) {
  const rankingContent = fs.readFileSync(rankingPath, 'utf-8');
  check(!rankingContent.includes('id="kpi-section"'), 'Verificación: KPIs removidos de Ranking y Promociones');
} else {
  console.log('⚠ [INFO] Archivo Ranking y Promociones.html no encontrado para verificar');
}

// Contar referencias a los nuevos KPIs
const kpiReferences = (content.match(/costumer-(puntaje-mensual|icon-ventas|bamo-ventas|icon-percent|bamo-percent)/g) || []).length;
console.log(`\n📊 Total referencias a nuevos KPIs: ${kpiReferences}`);

// Resultado final
console.log(`\n${'='.repeat(50)}`);
console.log(`✓ Pasadas: ${passed}`);
console.log(`✗ Fallidas: ${failed}`);
console.log(`${'='.repeat(50)}`);

if (failed === 0) {
  console.log('\n✅ Validación exitosa - Todos los tests pasaron\n');
  process.exit(0);
} else {
  console.log(`\n❌ Validación fallida - ${failed} test(s) fallaron\n`);
  process.exit(1);
}
