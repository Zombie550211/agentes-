#!/usr/bin/env node

/**
 * Script de Diagnóstico: Verificar por qué no aparecen las 2 ventas de hoy
 */

const fetch = require('node-fetch');

(async () => {
  try {
    console.log('\n🔍 DIAGNÓSTICO: Verificando ventas de hoy\n');

    // Obtener la fecha de hoy en formato YYYY-MM-DD
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const todayISO = `${yyyy}-${mm}-${dd}`;

    console.log(`📅 Fecha de hoy: ${todayISO}`);
    console.log(`📍 Zona horaria local: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`);

    // 1. Intentar obtener datos del servidor
    console.log('\n1️⃣ Obteniendo leads del servidor...\n');
    
    try {
      const url = `http://localhost:3000/api/leads?from=${todayISO}&to=${todayISO}&limit=100`;
      console.log(`   URL: ${url}`);
      
      const res = await fetch(url, {
        method: 'GET',
        credentials: 'include'
      });

      if (!res.ok) {
        console.log(`   ❌ Error HTTP ${res.status}`);
        const text = await res.text();
        console.log(`   Respuesta: ${text.substring(0, 200)}`);
        return;
      }

      const data = await res.json();
      const leads = Array.isArray(data?.leads) ? data.leads : (Array.isArray(data) ? data : []);

      console.log(`   ✅ Se obtuvieron ${leads.length} registros de hoy\n`);

      if (leads.length === 0) {
        console.log('   ⚠️  No hay registros en la BD para hoy');
        console.log('   → Verifica que la fecha en la BD sea correcta\n');
        return;
      }

      // 2. Analizar los registros
      console.log('2️⃣ Analizando registros:\n');

      leads.forEach((lead, idx) => {
        console.log(`   Registro ${idx + 1}:`);
        console.log(`   - ID: ${lead._id || lead.id || 'SIN ID'}`);
        console.log(`   - Nombre: ${lead.nombre || lead.name || 'SIN NOMBRE'}`);
        console.log(`   - Status: ${lead.status || 'SIN STATUS'}`);
        console.log(`   - Mercado: ${lead.mercado || 'SIN MERCADO'}`);
        console.log(`   - Fecha: ${lead.fecha_contratacion || lead.createdAt || lead.fecha || 'SIN FECHA'}`);
        console.log('');
      });

      // 3. Verificar filtros
      console.log('3️⃣ Verificar filtros activos en Costumer.html:\n');
      console.log('   - monthFilter: Debe estar vacío o en "Todos los meses"');
      console.log('   - teamFilter: Debe estar vacío o en "Todos los teams"');
      console.log('   - agentFilter: Debe estar vacío o en "Todos los agentes"');
      console.log('   - statusFilter: Debe estar en "Todos"');
      console.log('   - mercadoFilter: Debe estar vacío o en "Todos los mercados"\n');

      // 4. Consejos
      console.log('4️⃣ Si aún no ves los registros:\n');
      console.log('   a) Haz clic en el botón "Recargar" (🔄 azul)');
      console.log('   b) Haz clic en "Limpiar" (🚫 rojo) para resetear todos los filtros');
      console.log('   c) Recarga la página (F5 o Ctrl+F5 para limpiar caché)');
      console.log('   d) Verifica que los registros tengan la fecha de hoy\n');

    } catch (err) {
      console.log(`   ❌ Error conectando al servidor: ${err.message}`);
      console.log(`   → Asegúrate que el servidor esté corriendo en localhost:3000\n`);
    }

  } catch (err) {
    console.error('Error en diagnóstico:', err);
  }
})();
