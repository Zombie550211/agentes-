const express = require('express');
const router = express.Router();
const { getDb } = require('../config/db');
const { protect, authorize } = require('../middleware/auth');
const { ObjectId } = require('mongodb');
const multer = require('multer');

const imgUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ok = file.mimetype.startsWith('image/');
    cb(ok ? null : new Error('Solo se permiten imágenes'), ok);
  }
});

// Roles que pueden gestionar leads en "Nuevo Lead"
const isProcesamiento = (role) => {
  const r = String(role || '').toLowerCase().trim();
  return ['admin','administrador','administrator'].includes(r) || r.startsWith('procesamiento');
};

// Genera un ID de 5 dígitos único
async function generarLeadId(db) {
  const max = 99999;
  const min = 10000;
  let id;
  let intentos = 0;
  do {
    id = String(Math.floor(Math.random() * (max - min + 1)) + min);
    const existe = await db.collection('pre_leads').findOne({ leadId: id });
    if (!existe) break;
    intentos++;
  } while (intentos < 20);
  return id;
}

// POST /api/pre-leads — crear nuevo lead (cualquier usuario autenticado)
router.post('/', protect, async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'DB no disponible' });

    const {
      nombre, correo, phone1, phone2, direccion,
      fechaNacimiento, servicio, mercado, nota,
      agenteUsername, agenteName
    } = req.body;

    if (!nombre || !phone1 || !direccion || !servicio || !fechaNacimiento || !correo) {
      return res.status(400).json({ success: false, message: 'Faltan campos obligatorios' });
    }

    const leadId = await generarLeadId(db);
    const now = new Date();

    const doc = {
      leadId,
      nombre:          String(nombre).trim(),
      correo:          String(correo).trim(),
      phone1:          String(phone1).trim(),
      phone2:          String(phone2 || '').trim(),
      direccion:       String(direccion).trim(),
      fechaNacimiento: String(fechaNacimiento).trim(),
      servicio:        String(servicio).trim(),
      mercado:         String(mercado || '').trim(),
      nota:            String(nota || '').trim(),
      agenteUsername:  req.user.username || String(agenteUsername || '').trim(),
      agenteName:      req.user.name || String(agenteName || '').trim(),
      status:          null,
      notaProcesamiento: '',
      fechaVenta:      '',
      fechaInstalacion: '',
      resolucion:      null,
      creadoEn:        now,
      actualizadoEn:   now,
    };

    const result = await db.collection('pre_leads').insertOne(doc);
    doc._id = result.insertedId;

    res.status(201).json({ success: true, lead: doc });
  } catch (err) {
    console.error('[PRE-LEADS] POST error:', err);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

// GET /api/pre-leads — todos los leads (solo Admin/Procesamiento, filtrado por mercado)
router.get('/', protect, async (req, res) => {
  try {
    if (!isProcesamiento(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Acceso denegado' });
    }

    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'DB no disponible' });

    const roleNorm = String(req.user.role || '').toLowerCase().trim();
    const isAdmin  = ['admin', 'administrador', 'administrator'].includes(roleNorm);

    // Filtro de mercado según el tipo de procesamiento
    let query = {};
    if (!isAdmin) {
      if (roleNorm.includes('icon')) {
        query.mercado = { $regex: /^icon$/i };
      } else if (roleNorm.includes('bamo')) {
        query.mercado = { $regex: /^bamo$/i };
      }
      // 'procesamiento' genérico ve todos
    }

    const leads = await db.collection('pre_leads')
      .find(query)
      .sort({ creadoEn: -1 })
      .toArray();

    res.json({ success: true, leads: leads.map(l => ({ ...l, _id: String(l._id) })) });
  } catch (err) {
    console.error('[PRE-LEADS] GET error:', err);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

// GET /api/pre-leads/mis-leads — leads propios del agente
router.get('/mis-leads', protect, async (req, res) => {
  try {
    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'DB no disponible' });

    const leads = await db.collection('pre_leads')
      .find({ agenteUsername: req.user.username })
      .sort({ creadoEn: -1 })
      .toArray();

    res.json({ success: true, leads: leads.map(l => ({ ...l, _id: String(l._id) })) });
  } catch (err) {
    console.error('[PRE-LEADS] GET mis-leads error:', err);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

// PUT /api/pre-leads/:id — actualizar campos del lead (Admin/Procesamiento)
router.put('/:id', protect, async (req, res) => {
  try {
    if (!isProcesamiento(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Acceso denegado' });
    }

    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'DB no disponible' });

    let oid;
    try { oid = new ObjectId(req.params.id); } catch {
      return res.status(400).json({ success: false, message: 'ID inválido' });
    }

    const allowed = [
      'status', 'notaProcesamiento', 'fechaVenta', 'fechaInstalacion',
      'nombre', 'correo', 'phone1', 'phone2', 'direccion',
      'fechaNacimiento', 'servicio', 'mercado', 'nota'
    ];
    const update = {};
    allowed.forEach(k => {
      if (req.body[k] !== undefined) update[k] = String(req.body[k]).trim();
    });

    if (Object.keys(update).length === 0) {
      return res.status(400).json({ success: false, message: 'Sin campos para actualizar' });
    }

    update.actualizadoEn = new Date();

    const result = await db.collection('pre_leads').updateOne(
      { _id: oid },
      { $set: update }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: 'Lead no encontrado' });
    }

    res.json({ success: true });
  } catch (err) {
    console.error('[PRE-LEADS] PUT error:', err);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

// PUT /api/pre-leads/:id/resolver — marcar como completada o pendiente
router.put('/:id/resolver', protect, async (req, res) => {
  try {
    if (!isProcesamiento(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Acceso denegado' });
    }

    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'DB no disponible' });

    let oid;
    try { oid = new ObjectId(req.params.id); } catch {
      return res.status(400).json({ success: false, message: 'ID inválido' });
    }

    const { resolucion, notaProcesamiento, fechaVenta, fechaInstalacion } = req.body;
    const resoluciones = ['Venta Completada', 'Venta Pendiente'];
    if (!resoluciones.includes(resolucion)) {
      return res.status(400).json({ success: false, message: 'Resolución inválida' });
    }

    const update = {
      resolucion,
      resueltoEn:   new Date(),
      actualizadoEn: new Date(),
    };
    if (notaProcesamiento !== undefined) update.notaProcesamiento = notaProcesamiento;
    if (fechaVenta)       update.fechaVenta       = fechaVenta;
    if (fechaInstalacion) update.fechaInstalacion = fechaInstalacion;

    const result = await db.collection('pre_leads').updateOne(
      { _id: oid },
      { $set: update }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({ success: false, message: 'Lead no encontrado' });
    }

    res.json({ success: true, resolucion });
  } catch (err) {
    console.error('[PRE-LEADS] PUT resolver error:', err);
    res.status(500).json({ success: false, message: 'Error interno del servidor' });
  }
});

// POST /api/pre-leads/:id/images — subir imagen a Cloudinary
router.post('/:id/images', protect, imgUpload.single('image'), async (req, res) => {
  try {
    if (!isProcesamiento(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Acceso denegado' });
    }

    const db = getDb();
    if (!db) return res.status(500).json({ success: false, message: 'DB no disponible' });

    let oid;
    try { oid = new ObjectId(req.params.id); } catch {
      return res.status(400).json({ success: false, message: 'ID inválido' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No se recibió imagen' });
    }

    const cloudinary = require('cloudinary').v2;
    const url = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder: 'dashboard/lead-images', resource_type: 'image' },
        (err, result) => err ? reject(err) : resolve(result.secure_url)
      );
      stream.end(req.file.buffer);
    });

    await db.collection('pre_leads').updateOne(
      { _id: oid },
      { $push: { imagenes: url }, $set: { actualizadoEn: new Date() } }
    );

    res.json({ success: true, url });
  } catch (err) {
    console.error('[PRE-LEADS] Image upload error:', err);
    res.status(500).json({ success: false, message: 'Error al subir imagen' });
  }
});

module.exports = router;
