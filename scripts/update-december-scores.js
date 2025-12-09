#!/usr/bin/env node

/**
 * Script para actualizar puntajes en leads de Diciembre (mes 12) y generar reporte
 * 
 * Cambios:
 * - XFINITY Double Play: 0.95 → 1.00
 * - AT&T Internet Air 90-300Mbps: 0.35 → 0.45
 */

const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/crm';
const DB_NAME = process.env.DB_NAME || 'crm';

const UPDATES = [
  {
    service: 'XFINITY Double Play',
    oldScore: 0.95,
    newScore: 1.00,
    description: 'XFINITY Double Play (Internet + TV)'
  },
  {
    service: 'AT&T Internet Air 90-300Mbps',
    oldScore: 0.35,
    newScore: 0.45,
    description: 'AT&T Internet Air 90-300Mbps'
  }
];

async function updateDecemberScores() {
  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    console.log('✓ Conectado a MongoDB\n');

    const db = client.db(DB_NAME);
    const leadsCollection = db.collection('leads');

    const monthToUpdate = 12;
    const yearToUpdate = new Date().getFullYear();

    console.log(`📅 Actualizando leads de Diciembre ${yearToUpdate}...\n`);

    const affectedLeads = [];
    let totalUpdated = 0;

    for (const update of UPDATES) {
      console.log(`🔄 Procesando: ${update.description}`);
      console.log(`   Cambio: ${update.oldScore} → ${update.newScore}`);

      // Buscar leads ANTES de actualizar para extraer información
      const leadsToUpdate = await leadsCollection
        .find({
          service: update.service,
          'scores.base': update.oldScore,
          createdAt: {
            $gte: new Date(`${yearToUpdate}-12-01T00:00:00Z`),
            $lt: new Date(`${yearToUpdate}-12-32T23:59:59Z`)
          }
        })
        .project({
          _id: 1,
          agenteNombre: 1,
          createdAt: 1,
          service: 1,
          'scores.base': 1
        })
        .toArray();

      console.log(`   📋 Leads encontrados: ${leadsToUpdate.length}`);

      // Guardar información de leads afectados
      for (const lead of leadsToUpdate) {
        affectedLeads.push({
          _id: lead._id.toString(),
          agenteNombre: lead.agenteNombre || 'Sin nombre',
          service: lead.service,
          puntajeAnterior: update.oldScore,
          puntajeNuevo: update.newScore,
          fechaVenta: lead.createdAt ? lead.createdAt.toISOString().split('T')[0] : 'Sin fecha'
        });
      }

      // Actualizar los puntajes
      if (leadsToUpdate.length > 0) {
        const result = await leadsCollection.updateMany(
          {
            service: update.service,
            'scores.base': update.oldScore,
            createdAt: {
              $gte: new Date(`${yearToUpdate}-12-01T00:00:00Z`),
              $lt: new Date(`${yearToUpdate}-12-32T23:59:59Z`)
            }
          },
          {
            $set: {
              'scores.base': update.newScore,
              updatedAt: new Date(),
              scoreUpdatedAt: new Date(),
              scoreUpdateReason: `Actualización de puntaje: ${update.service} (${update.oldScore} → ${update.newScore})`
            }
          }
        );

        totalUpdated += result.modifiedCount;
        console.log(`   ✅ ${result.modifiedCount} leads actualizados\n`);
      } else {
        console.log(`   ⚠️  No se encontraron leads para actualizar\n`);
      }
    }

    // Generar reporte
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`✅ ACTUALIZACIÓN COMPLETADA`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`Total de leads actualizados: ${totalUpdated}`);
    console.log(`Mes afectado: Diciembre ${yearToUpdate}`);
    console.log(`\n`);

    // Mostrar lista formateada
    if (affectedLeads.length > 0) {
      console.log(`\n📊 LISTA DE LEADS ACTUALIZADOS\n`);
      console.log(
        '┌─────────────────────────────┬──────────────┬───────────────────────────┬─────────────┐'
      );
      console.log(
        '│ AGENTE                      │ FECHA VENTA  │ SERVICIO                  │ PUNTAJE     │'
      );
      console.log(
        '├─────────────────────────────┼──────────────┼───────────────────────────┼─────────────┤'
      );

      affectedLeads.forEach(lead => {
        const puntaje = `${lead.puntajeAnterior} → ${lead.puntajeNuevo}`;
        const agentePad = (lead.agenteNombre || 'Sin nombre').substring(0, 27).padEnd(27);
        const fechaPad = (lead.fechaVenta || 'Sin fecha').padEnd(12);
        const servicePad = (lead.service || 'N/A').substring(0, 25).padEnd(25);
        const puntajePad = puntaje.padEnd(11);
        console.log(
          `│ ${agentePad} │ ${fechaPad} │ ${servicePad} │ ${puntajePad} │`
        );
      });

      console.log(
        '└─────────────────────────────┴──────────────┴───────────────────────────┴─────────────┘'
      );

      // Guardar reporte en archivo
      const reportPath = path.join(
        __dirname,
        '../reports',
        `december-scores-update-${new Date().toISOString().split('T')[0]}.csv`
      );
      const reportsDir = path.dirname(reportPath);

      if (!fs.existsSync(reportsDir)) {
        fs.mkdirSync(reportsDir, { recursive: true });
      }

      const csvContent = [
        ['AGENTE', 'FECHA VENTA', 'SERVICIO', 'PUNTAJE ANTERIOR', 'PUNTAJE NUEVO'],
        ...affectedLeads.map(l => [
          l.agenteNombre,
          l.fechaVenta,
          l.service,
          l.puntajeAnterior,
          l.puntajeNuevo
        ])
      ]
        .map(row => row.map(cell => `"${cell}"`).join(','))
        .join('\n');

      fs.writeFileSync(reportPath, csvContent);
      console.log(`\n✓ Reporte guardado en: ${reportPath}`);
    }

    console.log(`\n`);

  } catch (error) {
    console.error('❌ Error durante la actualización:', error.message);
    process.exit(1);
  } finally {
    await client.close();
    console.log('✓ Desconectado de MongoDB\n');
  }
}

// Ejecutar
updateDecemberScores();
