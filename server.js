const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { MongoClient, ObjectId } = require('mongodb');
const axios = require('axios');

// Configuración
const JWT_SECRET = 'tu_clave_secreta_super_segura'; // cámbiala y guarda en .env en producción
const mongoUser = encodeURIComponent('Zombie550211');
const mongoPass = encodeURIComponent('Zombie5502');
const mongoCluster = 'cluster0.ywxaotz.mongodb.net';
const uri = `mongodb+srv://${mongoUser}:${mongoPass}@${mongoCluster}/?retryWrites=true&w=majority&appName=Cluster0`;
const dbName = 'sample_mflix'; // Cambia por tu base de datos real
const leadsCollectionName = 'crm agente';
const usersCollectionName = 'crm_users';

const CRM_ADMIN_URL = 'http://localhost:3000/api/sync/costumer'; // Reemplaza localhost:3000 si es diferente
const CRM_ADMIN_API_KEY = 'tu-clave-secreta-muy-larga-y-dificil-de-adivinar'; // Usa la misma clave que en el Admin

const app = express();
app.use(cors());
app.use(express.json());

// Servir archivos estáticos (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, 'public')));

let db, leads, users;

// Conexión a MongoDB
MongoClient.connect(uri)
  .then(client => {
    db = client.db(dbName);
    leads = db.collection(leadsCollectionName);
    users = db.collection(usersCollectionName);
    console.log('Conectado a MongoDB');
  })
  .catch(err => console.error('Error conectando a MongoDB:', err));

// Middleware de autenticación
function auth(req, res, next) {
  const header = req.headers['authorization'];
  if (!header) return res.status(401).json({ ok: false, error: 'No token' });
  const token = header.split(' ')[1];
  if (!token) return res.status(401).json({ ok: false, error: 'No token' });
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ ok: false, error: 'Token inválido' });
    req.user = user; // { id, nombre, email, rol }
    next();
  });
}

// Función para sincronizar con CRM Admin
async function sincronizarConAdmin(leadData) {
  const payload = {
    fecha: leadData.fecha,
    equipo: leadData.equipo, 
    agente: leadData.agente,
    telefono: leadData.telefono,
    producto: leadData.producto,
    puntaje: leadData.puntaje,
    cuenta: '', 
    direccion: leadData.direccion,
    zip: leadData.zip,
    estado: leadData.estado
  };

  try {
    console.log('Sincronizando con CRM Admin:', payload);
    await axios.post(CRM_ADMIN_URL, payload, {
      headers: {
        'x-api-key': CRM_ADMIN_API_KEY
      }
    });
    console.log('✅ Sincronización con CRM Admin exitosa.');

  } catch (error) {
    console.error('❌ Error al sincronizar con CRM Admin:');
    if (error.response) {
      console.error('   - Status:', error.response.status);
      console.error('   - Data:', error.response.data);
    } else if (error.request) {
      console.error('   - No se recibió respuesta del servidor Admin. ¿Está encendido?');
    } else {
      console.error('   - Error:', error.message);
    }
  }
}

// --- RUTAS DE LA API ---

// ENDPOINT TEMPORAL: CREAR ADMIN POR DEFECTO (SOLO DESARROLLO)
app.get('/api/dev/create-admin', async (req, res) => {
  try {
    const existe = await users.findOne({ email: 'admin@crm.com' });
    if (existe) {
      return res.json({ ok: false, mensaje: 'El usuario admin@crm.com ya existe.' });
    }
    const hashed = await bcrypt.hash('123456', 10);
    await users.insertOne({ nombre: 'Admin', email: 'admin@crm.com', password: hashed, rol: 'admin' });
    res.json({ ok: true, mensaje: 'Usuario administrador creado: admin@crm.com / 123456' });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Error interno.' });
  }
});

// ENDPOINT TEMPORAL: CREAR AGENTE DEMO POR DEFECTO (SOLO DESARROLLO)
app.get('/api/dev/create-agente', async (req, res) => {
  try {
    const existe = await users.findOne({ email: 'agente@crm.com' });
    if (existe) {
      return res.json({ ok: false, mensaje: 'El usuario agente@crm.com ya existe.' });
    }
    const hashed = await bcrypt.hash('demo123', 10);
    await users.insertOne({ nombre: 'Agente Demo', email: 'agente@crm.com', password: hashed, rol: 'agente' });
    res.json({ ok: true, mensaje: 'Usuario agente creado: agente@crm.com / demo123' });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Error interno.' });
  }
});

// REGISTRO DE USUARIOS (admin o agente)
app.post('/api/register', async (req, res) => {
  try {
    const { nombre, email, password, rol } = req.body;
    if (!nombre || !email || !password || !rol) {
      return res.status(400).json({ ok: false, error: "Faltan campos obligatorios." });
    }
    if (!['admin', 'agente'].includes(rol)) {
      return res.status(400).json({ ok: false, error: "Rol no permitido." });
    }
    const existe = await users.findOne({ email });
    if (existe) {
      return res.status(400).json({ ok: false, error: "El email ya está registrado." });
    }
    const hashed = await bcrypt.hash(password, 10);
    await users.insertOne({ nombre, email, password: hashed, rol });
    res.json({ ok: true, mensaje: "Usuario registrado correctamente." });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Error interno." });
  }
});

// LOGIN
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ ok: false, error: "Faltan campos." });
    const user = await users.findOne({ email });
    if (!user) return res.status(401).json({ ok: false, error: "Usuario o contraseña incorrectos." });
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ ok: false, error: "Usuario o contraseña incorrectos." });
    const token = jwt.sign({
      id: user._id,
      nombre: user.nombre,
      email: user.email,
      rol: user.rol
    }, JWT_SECRET, { expiresIn: '2d' });
    res.json({
      ok: true,
      token,
      user: {
        nombre: user.nombre,
        email: user.email,
        rol: user.rol
      }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: "Error interno." });
  }
});

// INFO DEL USUARIO AUTENTICADO
app.get('/api/agente/info', auth, async (req, res) => {
  res.json({
    nombre: req.user.nombre,
    email: req.user.email,
    rol: req.user.rol
  });
});

// LISTAR LEADS (solo propios si es agente, todos si es admin)
app.get('/api/leads', auth, async (req, res) => {
  try {
    let filtro = {};
    if (req.user.rol === 'agente') {
      filtro = { agente: req.user.nombre };
    }
    const listaLeads = await leads.find(filtro).toArray();
    res.json(listaLeads);
  } catch (error) {
    res.status(500).json({ ok: false, error });
  }
});

// CREAR LEAD (agente o admin)
app.post('/api/leads', auth, async (req, res) => {
  try {
    const lead = req.body;
    if (req.user.rol === 'agente') {
      lead.agente = req.user.nombre;
    } else if (req.user.rol === 'admin' && !lead.agente) {
      lead.agente = 'admin';
    }
    lead.comentarios_venta = lead.comentarios_venta || [];
    const result = await leads.insertOne(lead);
    const leadInsertado = { _id: result.insertedId, ...lead };

    sincronizarConAdmin(leadInsertado);

    res.json({ ok: true, lead: leadInsertado });
  } catch (error) {
    res.status(500).json({ ok: false, error });
  }
});

// OBTENER UN LEAD POR ID
app.get('/api/leads/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    let filtro = { _id: new ObjectId(id) };
    if (req.user.rol === 'agente') {
      filtro.agente = req.user.nombre;
    }
    const lead = await leads.findOne(filtro);
    res.json(lead);
  } catch (error) {
    res.status(500).json({ ok: false, error });
  }
});

// ACTUALIZAR LEAD (agente o admin)
app.put('/api/leads/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const leadActualizado = req.body;
    const venta = await leads.findOne({ _id: new ObjectId(id) });
    if (!venta) return res.status(404).json({ ok: false, error: "No encontrado." });
    if (req.user.rol !== 'admin' && venta.agente !== req.user.nombre) {
      return res.status(403).json({ ok: false, error: "No tienes permiso para borrar esta venta." });
    }
    await leads.updateOne({ _id: new ObjectId(id) }, { $set: leadActualizado });

    sincronizarConAdmin({ _id: id, ...leadActualizado });

    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error });
  }
});

// AGREGAR COMENTARIO SOBRE LA VENTA
app.post('/api/leads/:id/comentarios', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { comentario } = req.body;
    if (!comentario) return res.status(400).json({ ok: false, error: "Comentario vacío." });
    const venta = await leads.findOne({ _id: new ObjectId(id) });
    if (!venta) return res.status(404).json({ ok: false, error: "No encontrado." });
    if (req.user.rol !== 'admin' && venta.agente !== req.user.nombre) {
      return res.status(403).json({ ok: false, error: "No tienes permiso para comentar esta venta." });
    }
    const ahora = new Date();
    const fecha = ahora.toISOString();
    const comentarioFormateado = `[${fecha}] --> ${comentario.trim()}`;
    await leads.updateOne({ _id: new ObjectId(id) }, { $push: { comentarios_venta: comentarioFormateado } });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error });
  }
});

// BORRAR LEAD (solo admin o dueño)
app.delete('/api/leads/:id', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const venta = await leads.findOne({ _id: new ObjectId(id) });
    if (!venta) return res.status(404).json({ ok: false, error: "No encontrado." });
    if (req.user.rol !== 'admin' && venta.agente !== req.user.nombre) {
      return res.status(403).json({ ok: false, error: "No tienes permiso para borrar esta venta." });
    }
    await leads.deleteOne({ _id: new ObjectId(id) });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error });
  }
});

// LISTAR USUARIOS (solo admin, para test)
app.get('/api/users', auth, async (req, res) => {
  if (req.user.rol !== 'admin') return res.status(403).json({ ok: false, error: "Solo admins." });
  const lista = await users.find({}, { projection: { password: 0 } }).toArray();
  res.json(lista);
});


// --- RUTA FINAL PARA SERVIR LA APP DE FRONTEND ---
// ¡¡¡IMPORTANTE!!! Esta debe ser la ÚLTIMA ruta para que no sobreescriba las de la API
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Puerto para la API
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log('API escuchando en http://localhost:' + PORT);
});