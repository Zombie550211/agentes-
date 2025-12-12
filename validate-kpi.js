#!/usr/bin/env node

/**
 * Script de Validación: 3 KPIs Nuevos en Ranking y Promociones
 * Verifica que se hayan agregado correctamente:
 * 1. Puntaje Mensual (restando canceladas)
 * 2. VENTAS ICON
 * 3. VENTAS BAMO
 */

const fs = require('fs');
const path = require('path');

const filePath = path.join(__dirname, 'Ranking y Promociones.html');

if (!fs.existsSync(filePath)) {
  console.error('❌ Archivo no encontrado:', filePath);
  process.exit(1);
}

const content = fs.readFileSync(filePath, 'utf-8');
let passed = 0;
let failed = 0;

// Helper function
const check = (condition, message) => {
  if (condition) {
    console.log(`✓ [PASS] ${message}`);
    passed++;
  } else {
    console.log(`✗ [FAIL] ${message}`);
    failed++;
  }
};

console.log('\n🔍 Validando KPIs en Ranking y Promociones.html\n');

// 1. Verificar CSS para .kpi-section
check(content.includes('.kpi-section {'), 'CSS .kpi-section encontrado');

// 2. Verificar CSS para .kpi-card
check(content.includes('.kpi-card {'), 'CSS .kpi-card encontrado');

// 3. Verificar CSS para .kpi-grid
check(content.includes('.kpi-grid {'), 'CSS .kpi-grid encontrado');

// 4. Verificar HTML de la sección KPI
check(content.includes('id="kpi-section"'), 'HTML sección KPI con id="kpi-section"');

// 5. Verificar KPI 1: Puntaje Mensual
check(
  content.includes('Puntaje Mensual') && content.includes('id="kpi-monthly-points"'),
  'KPI 1: Puntaje Mensual implementado'
);

// 6. Verificar contadores para KPI 1
check(
  content.includes('id="kpi-sold-count"') && content.includes('id="kpi-cancelled-count"'),
  'KPI 1: Contadores de vendidas y canceladas implementados'
);

// 7. Verificar KPI 2: ICON
check(
  content.includes('ICON (Mercado)') && content.includes('id="kpi-icon-sales"'),
  'KPI 2: ICON (Mercado) implementado'
);

// 8. Verificar detalles para KPI 2
check(
  content.includes('id="kpi-icon-count"') && content.includes('id="kpi-icon-percent"'),
  'KPI 2: Cantidad y porcentaje de ICON implementados'
);

// 9. Verificar KPI 3: BAMO
check(
  content.includes('BAMO (Mercado)') && content.includes('id="kpi-bamo-sales"'),
  'KPI 3: BAMO (Mercado) implementado'
);

// 10. Verificar detalles para KPI 3
check(
  content.includes('id="kpi-bamo-count"') && content.includes('id="kpi-bamo-percent"'),
  'KPI 3: Cantidad y porcentaje de BAMO implementados'
);

// 11. Verificar función loadKPIMetrics
check(
  content.includes('async function loadKPIMetrics()'),
  'Función loadKPIMetrics definida'
);

// 12. Verificar cálculo de puntaje mensual en la función
check(
  content.includes('const monthlyPoints = vendidas'),
  'Cálculo de puntaje mensual implementado'
);

// 13. Verificar filtrado por mercado ICON
check(
  content.includes("l.mercado === 'ICON'") && content.includes("l.mercado === 'icon'"),
  'Filtrado por mercado ICON implementado'
);

// 14. Verificar filtrado por mercado BAMO
check(
  content.includes("l.mercado === 'BAMO'") && content.includes("l.mercado === 'bamo'"),
  'Filtrado por mercado BAMO implementado'
);

// 15. Verificar API call para obtener leads
check(
  content.includes('/api/leads?from='),
  'Request a /api/leads implementado'
);

// 16. Verificar manejo de estatus vendido/cerrado
check(
  content.includes("l.status === 'vendido'") && 
  content.includes("l.status === 'cerrado'"),
  'Filtrado por status vendido/cerrado implementado'
);

// 17. Verificar exclusión de canceladas
check(
  content.includes('!l.cancelada'),
  'Exclusión de ventas canceladas implementado'
);

// 18. Verificar clase .kpi-card.icon-market
check(
  content.includes('.kpi-card.icon-market'),
  'Clase CSS .kpi-card.icon-market para ICON'
);

// 19. Verificar clase .kpi-card.bamo-market
check(
  content.includes('.kpi-card.bamo-market'),
  'Clase CSS .kpi-card.bamo-market para BAMO'
);

// 20. Verificar clase .kpi-card.points
check(
  content.includes('.kpi-card.points'),
  'Clase CSS .kpi-card.points para Puntaje Mensual'
);

// 21. Verificar cálculo de porcentajes
check(
  content.includes('((iconVentas / totalLeadsConMercado) * 100)'),
  'Cálculo de porcentaje ICON implementado'
);

// 22. Verificar cálculo de porcentajes BAMO
check(
  content.includes('((bamoVentas / totalLeadsConMercado) * 100)'),
  'Cálculo de porcentaje BAMO implementado'
);

// 23. Verificar logs en consola
check(
  content.includes('[KPI]'),
  'Logs en consola con prefijo [KPI]'
);

// 24. Verificar actualización de elementos del DOM
check(
  content.includes("document.getElementById('kpi-monthly-points')") ||
  content.includes("const setElement = (id, value)"),
  'Actualización del DOM implementada'
);

// 25. Verificar llamada a loadKPIMetrics()
check(
  content.includes('await loadKPIMetrics()'),
  'Llamada a loadKPIMetrics() en DOMContentLoaded'
);

// Contar referencias a KPI
const kpiReferences = (content.match(/kpi-/g) || []).length;
console.log(`\n📊 Total referencias a 'kpi-': ${kpiReferences}`);

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
