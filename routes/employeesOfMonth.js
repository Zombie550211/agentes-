const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;
const { getDb } = require('../config/db');
const { protect, authorize } = require('../middleware/auth');

const uploadsDir = path.join(__dirname, '..', 'uploads');
const normalizeUrl = (v) => {
  try {
    const s0 = String(v || '').trim();
    if (!s0) return '';
    if (/^data:/i.test(s0)) return s0;
    const s = s0.replace(/\\+/g, '/');
    if (/^https?:\/\//i.test(s)) return s;
    if (!s.includes('/') && /\.[a-z0-9]{2,6}$/i.test(s)) return '/uploads/' + s;
    if (!s.startsWith('/')) return '/' + s;
    return s;
  } catch {
    return '';
  }
};

const isLocalUploads = (url) => {
  const u = String(url || '');
  return u.startsWith('/uploads/') || u.startsWith('uploads/');
};

const validateLocalUploadsUrl = (url) => {
  const u = normalizeUrl(url);
  if (!u) return '';
  if (!isLocalUploads(u)) return u;
  try {
    const fname = path.basename(u);
    const filePath = path.join(uploadsDir, fname);
    if (fs.existsSync(filePath)) return u;
    return '';
  } catch {
    return '';
  }
};

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
      imageUrl: validateLocalUploadsUrl(d.imageUrl || ''),
      imageData: d.imageData || null,
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

/**
 * @route POST /api/employees-of-month/migrate-cloudinary
 * @desc Migrar imágenes locales (/uploads) a Cloudinary y actualizar imageUrl
 * @access Private (admin)
 */
router.post('/migrate-cloudinary', protect, authorize('Administrador', 'admin', 'administrador'), async (req, res) => {
  try {
    const db = getDb();
    if (!db) {
      return res.status(500).json({ success: false, message: 'Error de conexión a la base de datos' });
    }

    const hasCloudinary = !!(
      process.env.CLOUDINARY_CLOUD_NAME &&
      process.env.CLOUDINARY_API_KEY &&
      process.env.CLOUDINARY_API_SECRET
    );
    if (!hasCloudinary) {
      return res.status(400).json({
        success: false,
        message: 'Cloudinary no está configurado (faltan CLOUDINARY_CLOUD_NAME / CLOUDINARY_API_KEY / CLOUDINARY_API_SECRET)'
      });
    }

    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET
    });

    const coll = db.collection('employeesOfMonth');
    const docs = await coll.find({}).toArray();
    const uploadsDir = path.join(__dirname, '..', 'uploads');

    let migrated = 0;
    let skipped = 0;
    let missing = 0;
    let errors = 0;
    const details = [];

    for (const d of (docs || [])) {
      const employee = d.employee;
      const existingUrl = String(d.imageUrl || '').trim();

      // Ya es URL remota
      if (/^https?:\/\//i.test(existingUrl)) {
        skipped++;
        continue;
      }

      const normalized = normalizeUrl(existingUrl);
      const isLocal = normalized.startsWith('/uploads/') || normalized.startsWith('uploads/');
      if (!isLocal) {
        skipped++;
        continue;
      }

      const filename = path.basename(normalized);
      const filePath = path.join(uploadsDir, filename);
      if (!fs.existsSync(filePath)) {
        missing++;
        details.push({ employee, status: 'missing_file', file: filename });
        continue;
      }

      try {
        const folder = 'crm/employees-of-month';
        const uploadResult = await cloudinary.uploader.upload(filePath, {
          folder,
          resource_type: 'image'
        });

        const secureUrl = uploadResult?.secure_url || '';
        const publicId = uploadResult?.public_id || null;
        if (!secureUrl) throw new Error('Cloudinary no devolvió secure_url');

        const now = new Date();
        await coll.updateOne(
          { _id: d._id },
          {
            $set: {
              imageUrl: secureUrl,
              cloudinaryPublicId: publicId,
              imageSource: 'cloudinary',
              updatedAt: now
            }
          }
        );

        migrated++;
        details.push({ employee, status: 'migrated', url: secureUrl });
      } catch (e) {
        errors++;
        details.push({ employee, status: 'error', error: e?.message || String(e) });
      }
    }

    return res.json({ success: true, migrated, skipped, missing, errors, details });
  } catch (error) {
    console.error('[EMPLOYEES OF MONTH MIGRATE] Error:', error);
    return res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

module.exports = router;
