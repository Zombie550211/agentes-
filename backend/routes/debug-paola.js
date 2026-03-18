const express = require('express');
const router = express.Router();
const { getDb } = require('../config/db');

/**
 * @route GET /api/debug-paola
 * @desc Debug endpoint para verificar lead de Paola Villalobos y usuario Icon 3
 */
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.status(500).json({ success: false, message: 'Error de conexión a la base de datos' });
    }

    const result = {
      lead: null,
      userIcon3: null,
      allIconUsers: []
    };

    // Buscar lead de Paola Villalobos en costumers_unified
    const leadUnified = await db.collection('costumers_unified').findOne({
      $or: [
        { nombre_cliente: { $regex: /paola.*villalobos/i } },
        { cliente: { $regex: /paola.*villalobos/i } },
        { NOMBRE_CLIENTE: { $regex: /paola.*villalobos/i } }
      ]
    });

    if (leadUnified) {
      result.lead = {
        collection: 'costumers_unified',
        cliente: leadUnified.nombre_cliente || leadUnified.cliente || leadUnified.NOMBRE_CLIENTE,
        agente: leadUnified.agenteNombre || leadUnified.agente,
        team: leadUnified.supervisor || leadUnified.team || leadUnified.equipo,
        mercado: leadUnified.mercado,
        status: leadUnified.status,
        dia_venta: leadUnified.dia_venta,
        was_reserva: leadUnified.was_reserva,
        excluirDeReporte: leadUnified.excluirDeReporte,
        _id: leadUnified._id
      };
    } else {
      // Buscar en costumers
      const leadCostumers = await db.collection('costumers').findOne({
        $or: [
          { nombre_cliente: { $regex: /paola.*villalobos/i } },
          { cliente: { $regex: /paola.*villalobos/i } },
          { NOMBRE_CLIENTE: { $regex: /paola.*villalobos/i } }
        ]
      });

      if (leadCostumers) {
        result.lead = {
          collection: 'costumers',
          cliente: leadCostumers.nombre_cliente || leadCostumers.cliente || leadCostumers.NOMBRE_CLIENTE,
          agente: leadCostumers.agenteNombre || leadCostumers.agente,
          team: leadCostumers.supervisor || leadCostumers.team || leadCostumers.equipo,
          mercado: leadCostumers.mercado,
          status: leadCostumers.status,
          dia_venta: leadCostumers.dia_venta,
          was_reserva: leadCostumers.was_reserva,
          excluirDeReporte: leadCostumers.excluirDeReporte,
          _id: leadCostumers._id
        };
      }
    }

    // Buscar usuario Icon 3
    const userIcon3 = await db.collection('users').findOne({
      $or: [
        { username: { $regex: /icon.*3/i } },
        { name: { $regex: /icon.*3/i } },
        { nombre: { $regex: /icon.*3/i } }
      ]
    });

    if (userIcon3) {
      result.userIcon3 = {
        username: userIcon3.username,
        name: userIcon3.name || userIcon3.nombre,
        role: userIcon3.role,
        team: userIcon3.team,
        email: userIcon3.email,
        _id: userIcon3._id
      };
    }

    // Buscar todos los usuarios con 'icon' en el nombre
    const usersIcon = await db.collection('users').find({
      $or: [
        { username: { $regex: /icon/i } },
        { name: { $regex: /icon/i } },
        { role: { $regex: /icon/i } }
      ]
    }).toArray();

    result.allIconUsers = usersIcon.map(u => ({
      username: u.username,
      name: u.name || u.nombre,
      role: u.role,
      team: u.team,
      email: u.email
    }));

    res.json({
      success: true,
      data: result
    });

  } catch (error) {
    console.error('[DEBUG PAOLA] Error:', error);
    res.status(500).json({ success: false, message: 'Error interno del servidor', error: error.message });
  }
});

module.exports = router;
