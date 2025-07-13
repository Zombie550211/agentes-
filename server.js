const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { MongoClient, ObjectId } = require('mongodb');

// Configuración
const JWT_SECRET = 'tu_clave_secreta_super_segura'; // cámbiala y guarda en .env en producción
const uri = 'mongodb+srv://Zombie550211:Zombie5502@cluster0.ywxaotz.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0';
const dbName = 'sample_mflix'; // Cambia por tu base de datos real
const leadsCollectionName = 'crm agente';
const usersCollectionName = 'crm_users';

const app = express();
app.use(cors());
app.use(express.json());

// Servir archivos estáticos (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, 'public')));

// Mostrar dashboard por defecto en "/"
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

let db, leads, users;

// Conexión a MongoDB
MongoClient.connect(uri, { useUnifiedTopology: true })
  .then(client => {
    db = client.db(dbName);
    leads = db.collection(leadsCollectionName);
    users = db.collection(usersCollectionName);
    console.log('Conectado a MongoDB');
  })
  .catch(err => console.error('Error conectando a MongoDB:', err));

// --- MIDDLEWARE AUTENTICACIÓN ---
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

// --- REGISTRO DE USUARIOS (admin o agente) ---
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

// --- LOGIN ---
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

// --- INFO DEL USUARIO AUTENTICADO ---
app.get('/api/agente/info', auth, async (req, res) => {
  res.json({
    nombre: req.user.nombre,
    email: req.user.email,
    rol: req.user.rol
  });
});

// --- CREAR LEAD (agente o admin) ---
app.post('/api/leads', auth, async (req, res) => {
  try {
    const lead = req.body;
    // Asigna el agente a la lead
    if (req.user.rol === 'agente') {
      lead.agente = req.user.nombre;
    } else if (req.user.rol === 'admin' && !lead.agente) {
      lead.agente = 'admin'; // O puedes dejarlo vacío o permitir elegir
    }
    lead.comentarios_venta = lead.comentarios_venta || [];
    const result = await leads.insertOne(lead);
    res.json({ ok: true, id: result.insertedId });
  } catch (error) {
    res.status(500).json({ ok: false, error });
  }
});

// --- LISTAR LEADS (solo propios si es agente, todos si es admin) ---
app.get('/api/leads', auth, async (req, res) => {
  try {
    let filtro = {};
    if (req.user.rol === 'agente') {
      filtro = { agente: req.user.nombre }; // Solo las propias
    }
    const allLeads = await leads.find(filtro).toArray();
    res.json(allLeads);
  } catch (error) {
    res.status(500).json({ ok: false, error });
  }
});

// --- AGREGAR COMENTARIO SOBRE LA VENTA ---
app.post('/api/leads/:id/comentarios', auth, async (req, res) => {
  try {
    const { id } = req.params;
    const { comentario } = req.body;
    if (!comentario) return res.status(400).json({ ok: false, error: "Comentario vacío." });
    // Solo permite comentar si eres admin o dueño de la venta
    const venta = await leads.findOne({ _id: new ObjectId(id) });
    if (!venta) return res.status(404).json({ ok: false, error: "No encontrado." });
    if (req.user.rol !== 'admin' && venta.agente !== req.user.nombre) {
      return res.status(403).json({ ok: false, error: "No tienes permiso para comentar esta venta." });
    }
    const ahora = new Date();
    const fecha = ahora.getFullYear() + '-' +
      String(ahora.getMonth() + 1).padStart(2, '0') + '-' +
      String(ahora.getDate()).padStart(2, '0') + ' ' +
      String(ahora.getHours()).padStart(2, '0') + ':' +
      String(ahora.getMinutes()).padStart(2, '0') + ':' +
      String(ahora.getSeconds()).padStart(2, '0');
    const comentarioFormateado = `[${fecha}] --> ${comentario.trim()}`;
    await leads.updateOne({ _id: new ObjectId(id) }, { $push: { comentarios_venta: comentarioFormateado } });
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error });
  }
});

// --- BORRAR LEAD (solo admin o dueño) ---
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

// --- LISTAR USUARIOS (solo admin, para test) ---
app.get('/api/users', auth, async (req, res) => {
  if (req.user.rol !== 'admin') return res.status(403).json({ ok: false, error: "Solo admins." });
  const lista = await users.find({}, { projection: { password: 0 } }).toArray();
  res.json(lista);
});

// Puerto para la API
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log('API escuchando en http://localhost:' + PORT);
});