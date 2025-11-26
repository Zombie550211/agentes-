const express = require('express');
const router = express.Router();
const { getDb } = require('../config/db');
const { protect, authorize } = require('../middleware/auth');

/**
 * @route GET /api/employees-of-month
 * @desc Obtener empleados del mes
 * @access Public (visible para todos)
 */
router.get('/', async (req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.status(500).json({ success: false, message: 'Error de conexión a la base de datos' });
    }
    const coll = db.collection('employeesOfMonth');
    // Devolver un ARRAY como espera el front
    const docs = await coll.find({}).sort({ updatedAt: -1 }).toArray();
    const response = docs.map(d => ({
      employee: d.employee, // 'first' | 'second'
      name: d.name || '',
      description: d.description || '',
      imageUrl: d.imageUrl || '',
      date: d.date || null,
      updatedAt: d.updatedAt || null
    }));
    return res.json(response);
  } catch (error) {
    console.error('[EMPLOYEES OF MONTH] Error:', error);
    return res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

/**
 * @route POST /api/employees-of-month
 * @desc Crear nuevo empleado del mes
 * @access Private
 */
router.post('/', protect, authorize('Administrador', 'admin', 'administrador'), async (req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.status(500).json({ success: false, message: 'Error de conexión a la base de datos' });
    }
    const coll = db.collection('employeesOfMonth');

    const { employee, name, description, imageUrl, date } = req.body || {};
    if (!employee || !['first','second'].includes(employee)) {
      return res.status(400).json({ success: false, message: 'Parámetro "employee" inválido (first|second)' });
    }

    const now = new Date();
    const doc = { employee, name: name||'', description: description||'', imageUrl: imageUrl||'', date: date||null, updatedAt: now };

    // Upsert por clave employee
    await coll.updateOne({ employee }, { $set: doc }, { upsert: true });

    return res.json({ success: true, message: 'Empleado del mes guardado', data: doc });
  } catch (error) {
    console.error('[EMPLOYEES OF MONTH CREATE] Error:', error);
    return res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

// DELETE /api/employees-of-month/:employee
router.delete('/:employee', protect, authorize('Administrador', 'admin', 'administrador'), async (req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.status(500).json({ success: false, message: 'Error de conexión a la base de datos' });
    }
    const coll = db.collection('employeesOfMonth');
    const employee = (req.params.employee||'').toString();
    if (!['first','second'].includes(employee)) {
      return res.status(400).json({ success: false, message: 'Parámetro "employee" inválido (first|second)' });
    }
    await coll.deleteOne({ employee });
    return res.json({ success: true, message: 'Empleado eliminado' });
  } catch (error) {
    console.error('[EMPLOYEES OF MONTH DELETE] Error:', error);
    return res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

module.exports = router;
