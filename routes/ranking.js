const express = require('express');
const router = express.Router();
const { getDb } = require('../config/db');

// Datos de prueba para ranking cuando MongoDB no esté disponible
const datosRankingPrueba = [
  {
    id: '1',
    nombre: 'Daniel Martinez',
    ventas: 25,
    puntos: 87.5,
    promedio: 3.5,
    posicion: 1,
    cargo: 'Agente Ejecutivo'
  },
  {
    id: '2',
    nombre: 'Ana García',
    ventas: 22,
    puntos: 78.2,
    promedio: 3.6,
    posicion: 2,
    cargo: 'Agente Senior'
  },
  {
    id: '3',
    nombre: 'Carlos López',
    ventas: 20,
    puntos: 71.0,
    promedio: 3.6,
    posicion: 3,
    cargo: 'Agente Senior'
  },
  {
    id: '4',
    nombre: 'María Rodríguez',
    ventas: 18,
    puntos: 65.4,
    promedio: 3.6,
    posicion: 4,
    cargo: 'Agente'
  },
  {
    id: '5',
    nombre: 'Luis Hernández',
    ventas: 16,
    puntos: 58.8,
    promedio: 3.7,
    posicion: 5,
    cargo: 'Agente'
  },
  {
    id: '6',
    nombre: 'Sofia Martínez',
    ventas: 15,
    puntos: 52.5,
    promedio: 3.5,
    posicion: 6,
    cargo: 'Agente'
  },
  {
    id: '7',
    nombre: 'Pedro Sánchez',
    ventas: 12,
    puntos: 42.0,
    promedio: 3.5,
    posicion: 7,
    cargo: 'Agente'
  },
  {
    id: '8',
    nombre: 'Laura Torres',
    ventas: 10,
    puntos: 35.0,
    promedio: 3.5,
    posicion: 8,
    cargo: 'Agente Junior'
  },
  {
    id: '9',
    nombre: 'Miguel Flores',
    ventas: 8,
    puntos: 28.0,
    promedio: 3.5,
    posicion: 9,
    cargo: 'Agente Junior'
  },
  {
    id: '10',
    nombre: 'Carmen Díaz',
    ventas: 6,
    puntos: 21.0,
    promedio: 3.5,
    posicion: 10,
    cargo: 'Agente Junior'
  }
];

// Endpoint para obtener datos del ranking de agentes
// Nota: este router se monta en server.js bajo '/api/ranking',
// por lo que el handler debe estar en '/'
router.get('/', async (req, res) => {
  try {
    console.log('=== ENDPOINT /api/ranking LLAMADO ===');
    console.log('Headers:', req.headers);
    
    let db;
    try {
      db = getDb();
    } catch (error) {
      console.log('[RANKING] MongoDB no disponible, usando datos de prueba');
      db = null;
    }
    
    if (!db) {
      console.log('[RANKING] Devolviendo datos de prueba');
      return res.json({
        success: true,
        ranking: datosRankingPrueba,
        totalAgentes: datosRankingPrueba.length,
        totalClientes: 150,
        message: 'Datos de prueba - MongoDB no disponible'
      });
    }
    
    console.log('Conexión a BD establecida correctamente');

    // Filtro por fecha (por defecto, día actual) y orden ascendente por fecha_contratacion
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const hoyStr = `${yyyy}-${mm}-${dd}`;
    const mesInicioStr = `${yyyy}-${mm}-01`;

    // Por defecto: acumulado del mes en curso (01..hoy)
    const qStart = (req.query.fechaInicio && String(req.query.fechaInicio).trim()) || mesInicioStr;
    const qEnd = (req.query.fechaFin && String(req.query.fechaFin).trim()) || hoyStr;
    const forceAll = String(req.query.forceAll || '0').toLowerCase();
    const noDateFilter = forceAll === '1' || forceAll === 'true';

    const filter = noDateFilter ? {} : { fecha_contratacion: { $gte: qStart, $lte: qEnd } };

    // Importante: si fecha_contratacion es string YYYY-MM-DD, sort lexicográfico funciona
    // Orden ASC para que una venta con fecha 01 se coloque junto a las del 01
    const customers = await db
      .collection('costumers')
      .find(filter)
      .sort({ fecha_contratacion: 1, _id: 1 })
      .toArray();
    
    // Agrupar por agente y calcular estadísticas
    const agentStats = {};
    
    customers.forEach(customer => {
      const agenteId = customer.agenteId || customer.creadoPor;
      const agenteNombre = customer.agenteNombre || 'Agente Desconocido';
      
      if (!agenteId) return; // Saltar si no hay agente asignado
      
      if (!agentStats[agenteId]) {
        agentStats[agenteId] = {
          id: agenteId,
          nombre: agenteNombre,
          ventas: 0,
          puntos: 0,
          clientes: []
        };
      }
      
      agentStats[agenteId].ventas += 1;
      agentStats[agenteId].puntos += parseFloat(customer.puntaje) || 0;
      agentStats[agenteId].clientes.push(customer);
    });
    
    // Convertir a array y ordenar por puntos
    const ranking = Object.values(agentStats)
      .map(agent => ({
        id: agent.id,
        nombre: agent.nombre,
        ventas: agent.ventas,
        puntos: Math.round(agent.puntos * 10) / 10, // Redondear a 1 decimal
        promedio: agent.ventas > 0 ? Math.round((agent.puntos / agent.ventas) * 10) / 10 : 0
      }))
      .sort((a, b) => b.puntos - a.puntos) // Ordenar por puntos descendente
      .slice(0, 10); // Top 10
    
    // Asignar posiciones y roles
    const rankingConPosiciones = ranking.map((agent, index) => {
      let cargo = 'Agente';
      if (index === 0) cargo = 'Agente Ejecutivo';
      else if (index === 1) cargo = 'Agente Senior';
      else if (index === 2) cargo = 'Agente Senior';
      else if (index >= 7) cargo = 'Agente Junior';
      
      return {
        ...agent,
        posicion: index + 1,
        cargo: cargo
      };
    });
    
    console.log(`Ranking generado con ${rankingConPosiciones.length} agentes`);
    
    res.json({
      success: true,
      ranking: rankingConPosiciones,
      totalAgentes: Object.keys(agentStats).length,
      totalClientes: customers.length
    });
    
  } catch (error) {
    console.error('Error al obtener ranking:', error);
    res.status(500).json({
      success: false,
      message: 'Error al obtener datos del ranking',
      error: error.message
    });
  }
});

module.exports = router;
