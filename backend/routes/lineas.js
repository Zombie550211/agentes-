const express    = require('express');
const { ObjectId } = require('mongodb');
const router     = express.Router();
const { getDb, getDbFor, isConnected } = require('../config/db');
const { protect } = require('../middleware/auth');
const { normalizeStatus } = require('../utils/statusNormalizer');
const { normalizeDateToString } = require('../utils/dateNormalizer');

// ── ROUND-ROBIN SUPERVISORES/AGENTES ─────────────────────────
const __supervisorKeys = ['JONATHAN F', 'LUIS G'];

async function pickNextSupervisorKey() {
  try {
    const cfg = getDb().collection('_rr_config');
    const doc = await cfg.findOneAndUpdate(
      { _id: 'rr_supervisor' },
      { $inc: { idx: 1 } },
      { upsert: true, returnDocument: 'after' }
    );
    const idx = ((doc.idx || 1) - 1) % __supervisorKeys.length;
    return __supervisorKeys[idx];
  } catch (_) {
    return __supervisorKeys[Math.floor(Math.random() * __supervisorKeys.length)];
  }
}

async function pickAgentRoundRobin(supervisorKey) {
  const { TEAMS } = require('../utils/teamsServer');
  const team = Object.values(TEAMS).find(t => (t.supervisorKey || '').toUpperCase() === (supervisorKey || '').toUpperCase());
  if (!team || !Array.isArray(team.agents) || !team.agents.length) return null;
  const agents = team.agents;
  const key = (supervisorKey || '').toUpperCase();
  try {
    const cfg = getDb().collection('_rr_config');
    const doc = await cfg.findOneAndUpdate(
      { _id: `rr_agent_${key}` },
      { $inc: { idx: 1 } },
      { upsert: true, returnDocument: 'after' }
    );
    const idx = ((doc.idx || 1) - 1) % agents.length;
    return agents[idx];
  } catch (_) {
    return agents[Math.floor(Math.random() * agents.length)];
  }
}

// ── WEBHOOK PÚBLICO (sin auth JWT, usa API key) ───────────────
const WEBHOOK_ALLOWED_ORIGINS = [
  'https://www.lineas-moviles.com',
  'https://lineas-moviles.com',
  'http://www.lineas-moviles.com',
  'http://lineas-moviles.com',
];

function setWebhookCors(req, res) {
  const origin = req.headers.origin || '';
  if (WEBHOOK_ALLOWED_ORIGINS.includes(origin)) {
    res.header('Access-Control-Allow-Origin', origin);
    res.header('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, x-api-key');
  }
}

router.options('/webhook/lineas', (req, res) => {
  setWebhookCors(req, res);
  res.sendStatus(204);
});

router.post('/webhook/lineas', (req, res, next) => {
  setWebhookCors(req, res);
  next();
}, async (req, res) => {
  try {
    const apiKey = req.headers['x-api-key'] || req.body?.api_key || '';
    const expectedKey = process.env.WEBHOOK_LINEAS_KEY || '';
    if (!expectedKey || apiKey !== expectedKey) {
      return res.status(401).json({ success: false, message: 'API key inválida' });
    }
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });

    const body = req.body || {};
    const clean = s => String(s || '').trim();
    const digitsOnly = s => String(s || '').replace(/\D+/g, '');

    const nombre   = clean(body.nombre   || body.nombre_cliente || '');
    const telefono = digitsOnly(body.telefono || body.telefono_principal || '');
    if (!nombre)   return res.status(400).json({ success: false, message: 'Campo requerido: nombre' });
    if (!telefono) return res.status(400).json({ success: false, message: 'Campo requerido: telefono' });

    const teamLineasDb = getDbFor('TEAM_LINEAS');
    if (!teamLineasDb) return res.status(503).json({ success: false, message: 'BD de Team Líneas no disponible' });

    const svNow    = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/El_Salvador' }));
    const todayStr = svNow.toLocaleDateString('en-CA', { timeZone: 'America/El_Salvador' });
    const supervisorKey  = body.supervisor ? clean(body.supervisor).toUpperCase() : await pickNextSupervisorKey();
    const assignedAgent  = (await pickAgentRoundRobin(supervisorKey)) || 'SIN ASIGNAR';

    const lead = {
      nombre_cliente:     nombre.toUpperCase(),
      telefono_principal: telefono,
      telefono_alt:       digitsOnly(body.telefono_alt || ''),
      direccion:          clean(body.direccion || body.address || ''),
      zip_code:           clean(body.zip || body.zip_code || ''),
      mercado:            String(body.mercado || 'BAMO').toUpperCase(),
      supervisor:         supervisorKey,
      servicio_interes:   clean(body.servicio || body.servicio_interes || ''),
      notas:              clean(body.notas || body.mensaje || ''),
      fuente:             clean(body.fuente || 'Chatbot AI'),
      status:             'pending',
      dia_venta:          new Date(todayStr),
      creadoEn:           new Date(),
      createdAt:          new Date(),
      agente:             assignedAgent,
      agenteNombre:       assignedAgent,
      cantidad_lineas:    Number(body.cantidad_lineas) || 1,
      _origen:            'botpress_webhook',
    };

    const col    = teamLineasDb.collection('ENTRANTES_CHATBOT');
    const result = await col.insertOne(lead);

    const leadPayload = { ...lead, _id: result.insertedId?.toString(), creadoEn: lead.creadoEn.toISOString() };
    if (global.io) global.io.emit('nuevo-lead-chatbot', leadPayload);

    return res.status(201).json({ success: true, message: 'Lead registrado correctamente en Team Líneas', id: result.insertedId?.toString() });
  } catch (e) {
    console.error('[WEBHOOK/LINEAS]', e.message);
    return res.status(500).json({ success: false, message: 'Error interno', error: e.message });
  }
});

router.get('/webhook/lineas', protect, async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    const teamLineasDb = getDbFor('TEAM_LINEAS');
    if (!teamLineasDb) return res.status(503).json({ success: false, message: 'BD de Team Líneas no disponible' });

    const { username, role } = req.user;
    const roleLc = (role || '').toLowerCase();
    const isAdminOrBO  = ['admin','administrador','backoffice','back office','back_office','bo'].some(r => roleLc.includes(r));
    const isSupervisor = roleLc.includes('supervisor');

    let filter = {};
    if (isAdminOrBO) {
      filter = {};
    } else if (isSupervisor) {
      const { TEAMS } = require('../utils/teamsServer');
      const myTeam = Object.values(TEAMS).find(t => (t.supervisor || '').toLowerCase() === username.toLowerCase());
      const supKey = myTeam ? myTeam.supervisorKey : null;
      filter = supKey ? { supervisor: supKey } : { supervisor: '__none__' };
    } else {
      // El chatbot guarda agentes como 'EDWARD RAMIREZ' (display name del round-robin),
      // pero el username del login puede ser 'edward.ramirez' o 'edward_ramirez'.
      // Incluimos ambos formatos para que el match funcione.
      const usernameAsDisplay = username.replace(/[._]/g, ' ').toUpperCase();
      filter = { $or: [
        { agente: username },
        { agenteNombre: username },
        { agente: usernameAsDisplay },
        { agenteNombre: usernameAsDisplay },
      ]};
    }

    const { limit = 100, skip = 0 } = req.query;
    const col   = teamLineasDb.collection('ENTRANTES_CHATBOT');
    const leads = await col.find(filter).sort({ creadoEn: -1 }).skip(Number(skip)).limit(Math.min(Number(limit), 500)).toArray();
    return res.json({ success: true, data: leads, total: leads.length });
  } catch (e) {
    console.error('[WEBHOOK/LINEAS GET]', e.message);
    return res.status(500).json({ success: false, message: 'Error interno', error: e.message });
  }
});

router.get('/lineas', protect, async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    const db = getDb();
    const { username, role } = req.user;
    const privilegedRoles = ['admin','administrador','backoffice','back office','back_office','bo','b.o','supervisor','supervisor team lineas'];
    const isPrivileged = privilegedRoles.some(r => (role||'').toLowerCase() === r || (role||'').toLowerCase().includes(r));
    const filter = isPrivileged ? {} : {
      $or: [{ agente: username },{ agenteNombre: username },{ createdBy: username },{ registeredBy: username }]
    };
    const registros = await db.collection('Lineas').find(filter).sort({ creadoEn: -1 }).toArray();
    return res.json({ success: true, data: registros, count: registros.length, user: username, filtered: !isPrivileged });
  } catch (e) {
    console.error('[GET /api/lineas]', e);
    return res.status(500).json({ success: false, message: 'Error al consultar Lineas', error: e.message });
  }
});

router.post('/lineas', protect, async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    const body     = req.body || {};
    const user     = req.user;
    const username = user?.username || '';

    const toUpper   = s => (s == null ? '' : String(s).trim().toUpperCase());
    const digitsOnly = s => (s == null ? '' : String(s).replace(/\D+/g,''));
    const asDate    = s => { if (!s) return null; return normalizeDateToString(s) || null; };
    const normalizeCollectionName = s => {
      try {
        return String(s||'').trim().normalize('NFD').replace(/[̀-ͯ]/g,'')
          .replace(/[^A-Za-z0-9_\s-]/g,' ').replace(/[\s-]+/g,'_').replace(/_+/g,'_')
          .replace(/^_+|_+$/g,'').toUpperCase() || 'UNKNOWN';
      } catch { return String(s||'').trim().replace(/[\s-]+/g,'_').toUpperCase() || 'UNKNOWN'; }
    };
    const normalizeAgentDisplay = s => String(s||'').trim().replace(/_/g,' ').replace(/\s+/g,' ').toUpperCase();

    const errors   = [];
    const required = ['nombre_cliente','telefono_principal','numero_cuenta','autopay','pin_seguridad','direccion','dia_venta','dia_instalacion','status','cantidad_lineas','id','mercado','supervisor'];
    for (const f of required) {
      if (body[f] == null || body[f] === '' || (Array.isArray(body[f]) && !body[f].length)) errors.push(`Campo requerido: ${f}`);
    }
    if (errors.length) return res.status(400).json({ success: false, message: 'Validación fallida', errors });

    const cantidadLineas = Number(body.cantidad_lineas || 0);
    const telefonos = (Array.isArray(body.telefonos) ? body.telefonos : []).map(digitsOnly).filter(Boolean);
    const servicios  = Array.isArray(body.servicios) ? body.servicios.map(String) : [];

    const autopayVal = String(body.autopay || '').toLowerCase();
    if (!['si','no'].includes(autopayVal)) errors.push('autopay debe ser si | no');

    const statusNorm = normalizeStatus(body.status);
    if (!['pending','rescheduled'].includes(statusNorm)) errors.push('status inválido (permitidos: pending, repro/rescheduled)');

    const mercado = String(body.mercado||'').toLowerCase();
    if (!['bamo','icon'].includes(mercado)) errors.push('mercado debe ser bamo | icon');

    let supervisorVal = String(body.supervisor||'').toLowerCase();
    if (!supervisorVal && user.supervisor) supervisorVal = String(user.supervisor).toLowerCase();
    else if (!supervisorVal && user.team) {
      const t = String(user.team).toLowerCase();
      if (t.includes('jonathan')) supervisorVal = 'jonathan f';
      else if (t.includes('luis')) supervisorVal = 'luis g';
    }
    if (!supervisorVal) errors.push('No se pudo determinar el supervisor');
    if (!['jonathan f','luis g'].includes(supervisorVal)) errors.push('supervisor inválido (permitidos: JONATHAN F, LUIS G)');
    if (!cantidadLineas || isNaN(cantidadLineas) || cantidadLineas < 1 || cantidadLineas > 5) errors.push('cantidad_lineas debe ser 1-5');
    if (telefonos.length !== cantidadLineas) errors.push('La cantidad de teléfonos debe coincidir con cantidad_lineas');
    if (errors.length) return res.status(400).json({ success: false, message: 'Validación fallida', errors });

    const teamLineasDb = getDbFor('TEAM_LINEAS');
    if (!teamLineasDb) return res.status(503).json({ success: false, message: 'BD de Team Líneas no disponible' });

    let targetAgent = username;
    if ((user.role||'').toLowerCase().includes('supervisor') && body.agenteAsignado) targetAgent = body.agenteAsignado;
    const targetCollectionName = normalizeCollectionName(targetAgent);

    const payloadLines    = Array.isArray(body.lines) ? body.lines : (Array.isArray(body.lineas) ? body.lineas : []);
    const payloadLineasSt = (body.lineas_status && typeof body.lineas_status === 'object') ? body.lineas_status : null;
    const normalizeLineSt = v => String(v||'').trim().toUpperCase() || '';

    const initialLineasStatus = {};
    const initialLines = [];
    for (let i = 0; i < cantidadLineas; i++) {
      let st = '';
      if (payloadLineasSt && Object.prototype.hasOwnProperty.call(payloadLineasSt, i)) st = normalizeLineSt(payloadLineasSt[i]);
      if (!st && payloadLines[i]) st = normalizeLineSt(payloadLines[i].estado ?? payloadLines[i].status ?? '');
      if (!st) st = statusNorm === 'pending' ? 'PENDING' : statusNorm.toUpperCase();
      initialLineasStatus[i] = st;
      initialLines.push({ telefono: telefonos[i]||digitsOnly(payloadLines[i]?.telefono)||'', servicio: servicios[i]||String(payloadLines[i]?.servicio||''), estado: st });
    }

    const now = new Date();
    const doc = {
      team: 'team lineas', nombre_cliente: toUpper(body.nombre_cliente),
      telefono_principal: digitsOnly(body.telefono_principal), numero_cuenta: String(body.numero_cuenta||'').trim(),
      autopay: autopayVal === 'si', pin_seguridad: String(body.pin_seguridad||'').trim(),
      direccion: String(body.direccion||'').trim(), servicios,
      dia_venta: asDate(body.dia_venta), dia_instalacion: asDate(body.dia_instalacion),
      status: statusNorm.toUpperCase(), cantidad_lineas: cantidadLineas, telefonos,
      ID: String(body.id||'').trim(), mercado: mercado.toUpperCase(), supervisor: supervisorVal.toUpperCase(),
      userId: user?._id || user?.id || null,
      agente:                   normalizeAgentDisplay(username),
      agenteAsignado:           normalizeAgentDisplay(targetAgent),
      agenteAsignadoCollection: targetCollectionName,
      lineas_status: initialLineasStatus, lines: initialLines,
      creadoEn: now, actualizadoEn: now, _raw: body
    };

    const result = await teamLineasDb.collection(targetCollectionName).insertOne(doc);
    return res.status(201).json({ success: true, message: `Guardado en TEAM_LINEAS > ${targetCollectionName}`, id: result.insertedId?.toString(), data: doc });
  } catch (e) {
    console.error('[POST /api/lineas]', e);
    return res.status(500).json({ success: false, message: 'Error al crear registro de Líneas', error: e.message });
  }
});

router.put('/lineas-team/update', protect, async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    const body     = req.body || {};
    const clientId = body.id;
    if (!clientId) return res.status(400).json({ success: false, message: 'ID requerido' });

    const toUpper = s => (s == null ? '' : String(s).trim().toUpperCase());
    const asDate  = s => { if (!s) return null; return normalizeDateToString(s) || null; };

    const updateData = {
      nombre_cliente:     body.nombre_cliente     ? toUpper(body.nombre_cliente) : undefined,
      telefono_principal: body.telefono_principal ? String(body.telefono_principal).replace(/\D+/g,'') : undefined,
      numero_cuenta:      body.numero_cuenta      ? String(body.numero_cuenta).trim() : undefined,
      cantidad_lineas:    body.cantidad_lineas    ? Number(body.cantidad_lineas) : undefined,
      status:             body.status             ? normalizeStatus(body.status).toUpperCase() : undefined,
      dia_venta:          body.dia_venta          ? asDate(body.dia_venta) : undefined,
      dia_instalacion:    body.dia_instalacion    ? asDate(body.dia_instalacion) : undefined,
      actualizadoEn:      new Date()
    };
    Object.keys(updateData).forEach(k => updateData[k] === undefined && delete updateData[k]);

    const teamLineasDb = getDbFor('TEAM_LINEAS');
    if (!teamLineasDb) return res.status(503).json({ success: false, message: 'BD de Team Líneas no disponible' });

    const cols = (await teamLineasDb.listCollections().toArray()).map(c => c.name).filter(Boolean);
    let updated = false;
    for (const colName of cols) {
      try {
        let filter;
        try { filter = { _id: new ObjectId(clientId) }; } catch (_) { filter = { _id: clientId }; }
        const result = await teamLineasDb.collection(colName).updateOne(filter, { $set: updateData });
        if (result && result.matchedCount > 0) { updated = true; break; }
      } catch (_) {}
    }
    if (!updated) return res.status(404).json({ success: false, message: 'Registro no encontrado' });
    return res.json({ success: true, message: 'Registro actualizado' });
  } catch (e) {
    console.error('[PUT /api/lineas-team/update]', e);
    return res.status(500).json({ success: false, message: 'Error al actualizar Líneas', error: e.message });
  }
});

router.post('/lineas-team/notes', protect, async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    const db = getDb();
    const { clientId, texto, type } = req.body || {};
    if (!clientId) return res.status(400).json({ success: false, message: 'clientId requerido' });
    let leadObjectId;
    try { leadObjectId = new ObjectId(clientId); } catch { leadObjectId = clientId; }
    const nota = { leadId: leadObjectId, texto: String(texto||'').slice(0, 1000), type: type || 'general', autor: req.user?.username || 'Sistema', createdAt: new Date() };
    await db.collection('lineas_notes').insertOne(nota);
    return res.json({ success: true, message: 'Nota guardada', data: nota });
  } catch (e) {
    console.error('[POST /api/lineas-team/notes]', e);
    return res.status(500).json({ success: false, message: 'Error al guardar nota', error: e.message });
  }
});

router.post('/lineas-team/notes/edit', protect, async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    const db = getDb();
    const { clientId, noteId, texto } = req.body || {};
    if (!clientId || !noteId) return res.status(400).json({ success: false, message: 'clientId y noteId requeridos' });
    let noteObjectId;
    try { noteObjectId = new ObjectId(noteId); } catch { noteObjectId = noteId; }
    const result = await db.collection('lineas_notes').updateOne(
      { _id: noteObjectId },
      { $set: { texto: String(texto||'').slice(0,1000), updatedAt: new Date(), updatedBy: req.user?.username } }
    );
    if (!result.matchedCount) return res.status(404).json({ success: false, message: 'Nota no encontrada' });
    return res.json({ success: true, message: 'Nota actualizada' });
  } catch (e) {
    console.error('[POST /api/lineas-team/notes/edit]', e);
    return res.status(500).json({ success: false, message: 'Error al editar nota', error: e.message });
  }
});

router.post('/lineas-team/notes/delete', protect, async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    const db = getDb();
    const { noteId } = req.body || {};
    if (!noteId) return res.status(400).json({ success: false, message: 'noteId requerido' });
    let noteObjectId;
    try { noteObjectId = new ObjectId(noteId); } catch { noteObjectId = noteId; }
    const result = await db.collection('lineas_notes').deleteOne({ _id: noteObjectId });
    if (!result.deletedCount) return res.status(404).json({ success: false, message: 'Nota no encontrada' });
    return res.json({ success: true, message: 'Nota eliminada' });
  } catch (e) {
    console.error('[POST /api/lineas-team/notes/delete]', e);
    return res.status(500).json({ success: false, message: 'Error al eliminar nota', error: e.message });
  }
});

router.delete('/lineas-team/delete', protect, async (req, res) => {
  try {
    if (!isConnected()) return res.status(503).json({ success: false, message: 'BD no disponible' });
    const clientId = (req.body || {}).id;
    if (!clientId) return res.status(400).json({ success: false, message: 'ID requerido' });
    const teamLineasDb = getDbFor('TEAM_LINEAS');
    if (!teamLineasDb) return res.status(503).json({ success: false, message: 'BD de Team Líneas no disponible' });
    const cols = (await teamLineasDb.listCollections().toArray()).map(c => c.name).filter(Boolean);
    let deleted = false;
    for (const colName of cols) {
      try {
        const result = await teamLineasDb.collection(colName).deleteOne({ _id: new ObjectId(clientId) });
        if (result.deletedCount > 0) { deleted = true; break; }
      } catch (_) {}
    }
    if (!deleted) return res.status(404).json({ success: false, message: 'Registro no encontrado' });
    return res.json({ success: true, message: 'Registro eliminado' });
  } catch (e) {
    console.error('[DELETE /api/lineas-team/delete]', e);
    return res.status(500).json({ success: false, message: 'Error al eliminar registro de Líneas', error: e.message });
  }
});

module.exports = router;
