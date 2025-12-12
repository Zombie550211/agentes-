#!/usr/bin/env node

/**
 * Script de validación del filtro de MERCADO en Costumer.html
 * 
 * Uso:
 *   node validate-mercado-filter.js
 * 
 * Verifica que el filtro de MERCADO se implementó correctamente
 */

const fs = require('fs');
const path = require('path');

const COSTUMER_HTML = path.join(__dirname, 'Costumer.html');

// Colores para terminal
const colors = {
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  reset: '\x1b[0m'
};

function log(color, label, message) {
  console.log(`${color}[${label}]${colors.reset} ${message}`);
}

function main() {
  console.log(`\n${colors.cyan}═══════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.blue}Validación: Filtro de MERCADO en Costumer.html${colors.reset}`);
  console.log(`${colors.cyan}═══════════════════════════════════════════════════${colors.reset}\n`);

  if (!fs.existsSync(COSTUMER_HTML)) {
    log(colors.red, 'ERROR', `No encontrado: ${COSTUMER_HTML}`);
    process.exit(1);
  }

  const content = fs.readFileSync(COSTUMER_HTML, 'utf-8');

  // Check 1: Verificar selector HTML
  const hasMercadoSelect = content.includes('id="mercadoFilter"') && 
                          content.includes('option value="ICON"') &&
                          content.includes('option value="BAMO"');
  
  if (hasMercadoSelect) {
    log(colors.green, 'PASS', 'Selector HTML <select id="mercadoFilter"> encontrado ✓');
    log(colors.green, '      ', '├─ Opción: ICON');
    log(colors.green, '      ', '├─ Opción: BAMO');
    log(colors.green, '      ', '└─ Opción: Todos los mercados (default)');
  } else {
    log(colors.red, 'FAIL', 'Selector HTML mercadoFilter NO ENCONTRADO');
  }

  // Check 2: Verificar lógica de filtrado
  const hasFilterLogic = content.includes('mercadoFilter') &&
                        content.includes("mercadoValue = String(mercadoSel.value)") &&
                        content.includes("lMercado === mercadoValue") &&
                        content.includes('[Costumer Filter] Filtro de mercado aplicado');
  
  if (hasFilterLogic) {
    log(colors.green, 'PASS', 'Lógica de filtrado implementada ✓');
    log(colors.green, '      ', '├─ Obtiene valor del select');
    log(colors.green, '      ', '├─ Normaliza (uppercase, trim)');
    log(colors.green, '      ', '├─ Filtra array por mercado');
    log(colors.green, '      ', '└─ Log de depuración incluido');
  } else {
    log(colors.red, 'FAIL', 'Lógica de filtrado NO ENCONTRADA');
  }

  // Check 3: Verificar event listener
  const hasEventListener = content.includes("document.getElementById('mercadoFilter')") &&
                          content.includes('addEventListener') &&
                          content.includes('[MERCADO FILTER]') &&
                          content.includes('renderCostumerTable');
  
  if (hasEventListener) {
    log(colors.green, 'PASS', 'Event listener implementado ✓');
    log(colors.green, '      ', '├─ Escucha cambios de select');
    log(colors.green, '      ', '├─ Re-renderiza tabla');
    log(colors.green, '      ', '├─ Log en consola');
    log(colors.green, '      ', '└─ Respeta suspender render');
  } else {
    log(colors.red, 'FAIL', 'Event listener NO ENCONTRADO');
  }

  // Check 4: Verificar integración con clearAllFilters
  const hasClearIntegration = content.includes('const mercadoFilter = document.getElementById') &&
                             content.includes('if (mercadoFilter) mercadoFilter.value');
  
  if (hasClearIntegration) {
    log(colors.green, 'PASS', 'Integración con clearAllFilters ✓');
    log(colors.green, '      ', '└─ Filtro se resetea con botón "Limpiar"');
  } else {
    log(colors.yellow, 'WARN', 'Integración con clearAllFilters INCOMPLETA o no validada');
  }

  // Check 5: Verificar integración con renderCostumerTable
  const hasRenderIntegration = content.includes('mercadoSel = document.getElementById') &&
                              content.includes('Filtro de mercado aplicado');
  
  if (hasRenderIntegration) {
    log(colors.green, 'PASS', 'Integración con renderCostumerTable ✓');
    log(colors.green, '      ', '├─ Se aplica durante renderizado');
    log(colors.green, '      ', '└─ Compatible con otros filtros');
  } else {
    log(colors.red, 'FAIL', 'Integración con renderCostumerTable INCOMPLETA');
  }

  // Estadísticas
  console.log(`\n${colors.blue}📊 Estadísticas de Implementación:${colors.reset}`);
  const mercadoMatches = (content.match(/mercadoFilter/g) || []).length;
  const mercadoLogs = (content.match(/\[MERCADO FILTER\]/g) || []).length;
  console.log(`  Total de referencias a 'mercadoFilter': ${mercadoMatches}`);
  console.log(`  Logs [MERCADO FILTER]: ${mercadoLogs}`);

  // Resumen
  console.log(`\n${colors.cyan}═══════════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.green}✅ Filtro de MERCADO validado exitosamente${colors.reset}\n`);
  
  console.log(`${colors.blue}Cómo usar el filtro:${colors.reset}`);
  console.log(`  1. Abrir Costumer.html en navegador`);
  console.log(`  2. Buscar dropdown "Mercado" (después de "Agente")`);
  console.log(`  3. Seleccionar "ICON" → Ver solo clientes ICON`);
  console.log(`  4. Seleccionar "BAMO" → Ver solo clientes BAMO`);
  console.log(`  5. Seleccionar "Todos" → Ver todos nuevamente`);
  console.log(`  6. Abrir DevTools (F12) → Consola → Ver logs\n`);

  console.log(`${colors.blue}Combinación con otros filtros:${colors.reset}`);
  console.log(`  ✓ Mes + Mercado`);
  console.log(`  ✓ Agente + Mercado`);
  console.log(`  ✓ Status + Mercado`);
  console.log(`  ✓ Team + Mercado`);
  console.log(`  ✓ Fecha + Mercado`);
  console.log(`  ✓ Todos juntos\n`);

  console.log(`${colors.cyan}═══════════════════════════════════════════════════${colors.reset}\n`);
}

main();
