require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { MongoClient, ObjectId } = require('mongodb');
const axios = require('axios');

// Configuración
const JWT_SECRET = process.env.JWT_SECRET || 'tu_clave_secreta_super_segura'; // Prioriza la clave del .env
const uri = process.env.MONGODB_URI;
console.log(`[DEBUG] JWT_SECRET cargada: ${process.env.JWT_SECRET ? 'Sí, desde .env' : 'No, usando valor por defecto'}`);
const dbName = 'sample_mflix'; // Cambia por tu base de datos real
const leadsCollectionName = 'crm agente';
const usersCollectionName = 'crm_users';

const CRM_ADMIN_URL = 'https://connecting-klf7.onrender.com/api/sync/costumer'; // Reemplaza localhost:3000 si es diferente
const CRM_ADMIN_API_KEY = 'tu-clave-secreta-muy-larga-y-dificil-de-adivinar'; // Usa la misma clave que en el Admin

const app = express();

// Configuración de CORS
const corsOptions = {
  origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:3003'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  optionsSuccessStatus: 200 // Para navegadores antiguos (IE11, varios SmartTVs)
};

app.use(cors(corsOptions));
app.use(express.json());

// Manejar solicitudes OPTIONS (preflight)
app.options('*', cors(corsOptions));

// Servir archivos estáticos (HTML, CSS, JS)
app.use(express.static(path.join(__dirname, 'public')));

// Middleware de autenticación básico (comentado temporalmente para pruebas)
/*
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Token requerido' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ error: 'Token inválido' });
    req.user = user;
    next();
  });
};
*/

let db, leads, users;

// Conexión a MongoDB
console.log('[DEBUG] Intentando conectar a MongoDB con URI:', uri.replace(/:[^:]*@/, ':***@'));
MongoClient.connect(uri)
  .then(client => {
    console.log('[DEBUG] Conexión exitosa a MongoDB');
    db = client.db(dbName);
    console.log(`[DEBUG] Usando base de datos: ${dbName}`);
    
    // Verificar colecciones
    db.listCollections().toArray((err, collections) => {
      if (err) {
        console.error('[ERROR] Error al listar colecciones:', err);
        return;
      }
      console.log('[DEBUG] Colecciones disponibles:', collections.map(c => c.name));
    });
    
    leads = db.collection(leadsCollectionName);
    users = db.collection(usersCollectionName);
    
    // Verificar si la colección de leads tiene documentos
    leads.countDocuments({}, (err, count) => {
      if (err) {
        console.error('[ERROR] Error al contar documentos en leads:', err);
        return;
      }
      console.log(`[DEBUG] Número de documentos en ${leadsCollectionName}:`, count);
    });
    
    console.log('Conectado a MongoDB');
    // Iniciar el servidor solo cuando la BD esté lista
    app.listen(3003, () => {
      console.log('API escuchando en http://localhost:3003');
    });
  })
  .catch(err => {
    console.error('[ERROR] Error conectando a MongoDB:', err);
    console.error('[DEBUG] URI de conexión usada:', uri.replace(/:[^:]*@/, ':***@'));
  });



// Función para sincronizar con CRM Admin
async function sincronizarConAdmin(leadData) {
  // Función auxiliar para agregar "team" solo al supervisor
  const agregarTeamSupervisor = (supervisor) => {
    if (!supervisor) return '';
    const supervisorStr = String(supervisor);
    if (/^team\s/i.test(supervisorStr)) return supervisorStr;
    return `team ${supervisorStr}`;
  };

  // Clonar el objeto para no modificar el original
  const leadPayload = { ...leadData };
  // Solo el campo supervisor lleva el prefijo
  leadPayload.supervisor = agregarTeamSupervisor(leadData.supervisor);

  try {
    await axios.post(CRM_ADMIN_URL, leadPayload, {
      headers: {
        'x-api-key': CRM_ADMIN_API_KEY,
        'Content-Type': 'application/json'
      }
    });
    console.log('[SYNC] Lead sincronizado con Admin:', leadPayload);
  } catch (err) {
    console.error('[SYNC ERROR] Error al sincronizar con Admin:', err?.response?.data || err.message);
  }
}

// --- RUTAS DE LA API ---

// Verificar token JWT
app.get('/api/verify-token', (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ ok: false, error: 'No se proporcionó token' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ ok: false, error: 'Formato de token inválido' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ ok: false, error: 'Token inválido o expirado' });
    }
    // Token válido
    res.json({ ok: true, user: decoded });
  });
});

// REGISTRO DE USUARIOS
app.post('/api/register', async (req, res) => {
  try {
    const { nombre, email, password, rol } = req.body;
    if (!nombre || !email || !password || !rol) {
      return res.status(400).json({ ok: false, error: 'Faltan campos obligatorios.' });
    }
    const existe = await users.findOne({ email });
    if (existe) return res.status(400).json({ ok: false, error: 'Email ya registrado.' });

    const hashed = await bcrypt.hash(password, 10);
    await users.insertOne({ nombre, email, password: hashed, rol });
    res.json({ ok: true, mensaje: 'Usuario registrado correctamente.' });
  } catch (error) {
    res.status(500).json({ ok: false, error: 'Error interno.' });
  }
});

// LOGIN
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body; // Cambiado de 'email' a 'username'
    if (!username || !password) return res.status(400).json({ ok: false, error: 'Faltan campos.' });
    
    const user = await users.findOne({ email: username }); // Buscamos por email usando el username
    if (!user) return res.status(401).json({ ok: false, error: 'Credenciales incorrectas.' });

    const passOk = await bcrypt.compare(password, user.password);
    if (!passOk) return res.status(401).json({ ok: false, error: 'Credenciales incorrectas.' });

    const token = jwt.sign(
      { id: user._id, nombre: user.nombre, rol: user.rol, email: user.email },
      JWT_SECRET,
      { expiresIn: '1h' } // Token expira en 1 hora
    );

    res.json({ 
      ok: true, 
      token, 
      user: { nombre: user.nombre, email: user.email, rol: user.rol } 
    });

  } catch (error) {
    res.status(500).json({ ok: false, error: 'Error interno.' });
  }
});

// LISTAR TODOS LOS LEADS (SIN AUTENTICACIÓN - TEMPORAL)
// Ruta principal - manejo mejorado para evitar redirecciones
app.get('/', (req, res) => {
  // Verificar si ya está autenticado
  const token = req.headers.authorization?.split(' ')[1];
  
  if (!token) {
    // Si no hay token, redirigir al login
    return res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
  }
  
  // Verificar el token
  jwt.verify(token, JWT_SECRET, (err) => {
    if (err) {
      // Token inválido o expirado, redirigir al login
      return res.status(200).json({ message: 'Acceso permitido' });
    }
    // Token válido, redirigir al dashboard
    res.status(200).json({ message: 'Acceso permitido' });
  });
});

app.get('/api/leads', async (req, res) => {
  try {
    console.log('[LOG] Petición recibida en GET /api/leads (sin autenticación)');
    const listaLeads = await leads.find({}).toArray();
    console.log(`[LOG] Consulta a DB exitosa. Encontrados ${listaLeads.length} leads.`);
    res.json(listaLeads);
  } catch (error) {
    console.error('[ERROR] Fallo en la ruta GET /api/leads:', error);
    res.status(500).json({ ok: false, error: error.message });
  }
});

// CREAR LEAD (agente o admin)
app.post('/api/leads', async (req, res) => {
  try {
    const lead = req.body;

    lead.agente = 'agente_default'; // Agente por defecto

    // Normalización y validación de puntaje y team
    if (lead.supervisor) {
      const supervisor = lead.supervisor.toUpperCase();
      let team = '';
      switch (supervisor) {
        case 'PLEITEZ': team = 'TEAM PLEITEZ'; break;
        case 'ROBERTO': team = 'TEAM ROBERTO'; break;
        case 'IRANIA': team = 'TEAM IRANIA'; break;
        case 'MARISOL': team = 'TEAM MARISOL'; break;
        case 'RANDAL': team = 'TEAM RANDAL'; break;
        case 'JONATHAN': team = 'TEAM LINEAS'; break;
        default: team = `TEAM ${supervisor}`;
      }
      lead.team = team;
      if (supervisor === 'JONATHAN') {
        lead.puntaje = 'Sin Puntaje';
      } else {
        if (lead.puntaje === undefined || lead.puntaje === null || lead.puntaje === '') {
          return res.status(400).json({ ok: false, error: 'El campo puntaje es obligatorio.' });
        }
        // Forzar a número decimal si es string
        if (typeof lead.puntaje === 'string') {
          lead.puntaje = parseFloat(lead.puntaje);
        }
        if (isNaN(lead.puntaje)) {
          return res.status(400).json({ ok: false, error: 'El campo puntaje debe ser un número válido.' });
        }
      }
    } else {
      return res.status(400).json({ ok: false, error: 'El campo supervisor es obligatorio.' });
    }

    // Usamos la fecha local en formato YYYY-MM-DD sin conversión de zona horaria
    const hoy = new Date();
    // Obtenemos la fecha local directamente sin ajustes de zona horaria
    const fechaLocal = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
    lead.creadoEn = fechaLocal;
    
    // Insertamos el lead en la base de datos
    const result = await leads.insertOne(lead);

    // Creamos y guardamos el documento en la colección 'costumer'
    const costumerData = {
      agente: lead.agente,
      nombre_cliente: lead.nombre_cliente,
      telefono: lead.telefono,
      telefono_alterno: lead.telefono_alterno,
      numero_de_cuenta: lead.numero_de_cuenta,
      autopaquete: lead.autopaquete,
      direccion: lead.direccion,
      tipo_de_serv: lead.tipo_de_serv,
      sistema: lead.sistema,
      riesgo: lead.riesgo,
      dia_venta_a_instalacion: lead.dia_venta_a_instalacion,
      estado: "PENDIENTE", // Valor fijo según la imagen
      servicios: lead.servicios,
      mercado: lead.mercado,
      supervisor: lead.supervisor,
      comentario: lead.comentario,
      motivo_llamada: lead.motivo_llamada,
      zip: lead.zip,
      puntaje: lead.puntaje,
      fecha: lead.creadoEn,
      equipo: lead.team,
      producto: lead.producto,
      cuenta: lead.cuenta
    };
    const costumers = db.collection('costumers');
    await costumers.insertOne(costumerData);

    // Creamos un objeto del lead insertado para devolverlo y sincronizarlo
    const orderedFields = [
      '_id',
      'nombre_cliente',
      'telefono_principal',
      'telefono_alterno',
      'numero_cuenta',
      'autopago',
      'direccion',
      'tipo_servicios',
      'sistema',
      'riesgo',
      'dia_venta',
      'dia_instalacion',
      'status',
      'servicios',
      'mercado',
      'supervisor',
      'comentario',
      'motivo_llamada',
      'zip_code',
      'puntaje',
      'comentarios_venta',
      'team',
      'agente',
      'creadoEn'
    ];
    const ordenarLead = (lead) => {
      const obj = {};
      orderedFields.forEach(k => { if (lead[k] !== undefined) obj[k] = lead[k]; });
      Object.keys(lead).forEach(k => { if (!(k in obj)) obj[k] = lead[k]; });
      return obj;
    };
    const leadInsertado = ordenarLead({ _id: result.insertedId, ...lead });

    // Sincronizamos con el CRM Admin
    await sincronizarConAdmin(leadInsertado);

    // Respondemos al frontend
    res.json({ ok: true, lead: leadInsertado });
  } catch (error) {
    console.error('Error al guardar lead:', error);
    res.status(500).json({ ok: false, error: error.message || 'Error interno del servidor' });
  }
});

// OBTENER UN LEAD POR ID
app.get('/api/leads/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const filtro = { _id: new ObjectId(id) };
    const lead = await leads.findOne(filtro);
    res.json(lead);
  } catch (error) {
    res.status(500).json({ ok: false, error });
  }
});

// ACTUALIZAR LEAD (agente o admin)
app.put('/api/leads/:id', async (req, res) => {
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

// OBTENER COMENTARIOS DE UN LEAD
app.get('/api/leads/:id/comentarios', async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: 'ID de lead inválido' });
    }

    const costumers = db.collection('costumers');
    const lead = await costumers.findOne({ _id: new ObjectId(id) });

    if (!lead) {
      return res.status(404).json({ ok: false, error: 'Lead no encontrado' });
    }

    // Devolver los comentarios o un array vacío si no existen
    res.json(lead.comentarios_venta || []);

  } catch (error) {
    console.error('Error al obtener comentarios:', error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// AGREGAR UN NUEVO COMENTARIO A UN LEAD
app.post('/api/leads/:id/comentarios', async (req, res) => {
  try {
    const { id } = req.params;
    const { texto } = req.body;
    if (!texto) {
      return res.status(400).json({ ok: false, error: 'El texto del comentario no puede estar vacío.' });
    }
    const costumers = db.collection('costumers');
    // Permitir comentar a cualquier usuario autenticado
    // Generar autor y fecha en el servidor para consistencia
    const autor = 'agente_default'; // Usar un nombre de agente o req.user.nombre si la autenticación estuviera activa
    const fecha = new Date();
    const comentarioObj = { autor, fecha, texto };

    const resultado = await costumers.updateOne(
      { _id: new ObjectId(id) }, 
      { $push: { comentarios_venta: comentarioObj } }
    );

    if (resultado.modifiedCount === 0) {
        return res.status(404).json({ ok: false, error: 'No se pudo encontrar el lead para agregar el comentario.' });
    }

    res.status(201).json(comentarioObj);
  } catch (error) {
    res.status(500).json({ ok: false, error });
  }
});

// --- RUTAS PARA COMENTARIOS DE COSTUMERS ---

// OBTENER COMENTARIOS DE UN COSTUMER
app.get('/api/costumers/:id/comentarios', async (req, res) => {
  try {
    const { id } = req.params;
    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: 'ID de costumer inválido' });
    }
    const costumers = db.collection('costumers');
    const costumer = await costumers.findOne({ _id: new ObjectId(id) });

    if (!costumer) {
      return res.status(404).json({ ok: false, error: 'Costumer no encontrado' });
    }

    res.json(costumer.comentarios_venta || []);

  } catch (error) {
    console.error('Error al obtener comentarios de costumer:', error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// AGREGAR UN NUEVO COMENTARIO A UN COSTUMER
app.post('/api/costumers/:id/comentarios', async (req, res) => {
  try {
    const { id } = req.params;
    const { texto } = req.body;

    if (!ObjectId.isValid(id)) {
      return res.status(400).json({ ok: false, error: 'ID de costumer inválido' });
    }
    if (!texto) {
      return res.status(400).json({ ok: false, error: 'El texto del comentario no puede estar vacío.' });
    }

    const costumers = db.collection('costumers');
    
    const autor = 'agente_default';
    const fecha = new Date();
    const comentarioObj = { autor, fecha, texto };

    const resultado = await costumers.updateOne(
      { _id: new ObjectId(id) }, 
      { $push: { comentarios_venta: comentarioObj } }
    );

    if (resultado.modifiedCount === 0) {
        return res.status(404).json({ ok: false, error: 'No se pudo encontrar el costumer para agregar el comentario.' });
    }

    res.status(201).json(comentarioObj);
  } catch (error) {
    console.error('Error al guardar comentario de costumer:', error);
    res.status(500).json({ ok: false, error: 'Error interno del servidor' });
  }
});

// BORRAR LEAD
app.delete('/api/leads/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await leads.deleteOne({ _id: new ObjectId(id) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ ok: false, error: "No encontrado." });
    }
    res.json({ ok: true });
  } catch (error) {
    res.status(500).json({ ok: false, error });
  }
});




// --- RUTA FINAL PARA SERVIR LA APP DE FRONTEND ---
// ¡¡¡IMPORTANTE!!! Esta debe ser la ÚLTIMA ruta para que no sobreescriba las de la API
app.get('/register.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'register.html'));
});

// La ruta del dashboard ahora está protegida
app.get('/dashboard.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// Redirigir cualquier otra ruta no definida al login
app.get('*', (req, res) => {
  res.status(200).json({ message: 'Acceso permitido' });
});
