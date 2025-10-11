const express = require("express");
const session = require("express-session");
const path = require("path");
const bodyParser = require("body-parser");
const fs = require("fs");
const XLSX = require("xlsx");

const app = express();
const PORT = 3000;

// Usuarios simulados
const usuarios = [
  { username: "admin", password: "1234" },
  { username: "superadmin", password: "mipass2025", rol: "admin" },
  { username: "admin@crm.com", password: "admin2025", rol: "admin" }
];

// Middlewares
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));
app.use("/login", express.static(path.join(__dirname, "public", "login")));

// Sesiones
app.use(
  session({
    secret: "crm-secret-key",
    resave: false,
    saveUninitialized: false,
  })
);

// Middleware autenticación
function protegerRuta(req, res, next) {
  if (req.session.usuario) {
    next();
  } else {
    res.redirect("/login/login.html");
  }
}

// Rutas
app.get("/", (req, res) => res.redirect("/login/login.html"));
app.get("/login.html", (req, res) => res.redirect("/login/login.html"));
app.get("/login/login.html", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "login", "login.html"))
);
app.get("/login/register.html", (req, res) =>
  res.sendFile(path.join(__dirname, "public", "login", "register.html"))
);
app.get("/lead.html", protegerRuta, (req, res) =>
  res.sendFile(path.join(__dirname, "public", "lead.html"))
);
app.get("/costumer.html", protegerRuta, (req, res) =>
  res.sendFile(path.join(__dirname, "public", "costumer.html"))
);

// Login
app.post("/api/login", (req, res) => {
  const { username, password } = req.body;
  const user = usuarios.find(
    (u) => u.username === username && u.password === password
  );
  if (user) {
    req.session.usuario = user.username;
    res.json({ ok: true });
  } else {
    res.status(401).json({ ok: false, mensaje: "Credenciales incorrectas" });
  }
});

// Logout
app.post("/api/logout", (req, res) => {
  req.session.destroy(() => {
    res.redirect("/login/login.html");
  });
});

// Registro
app.post("/api/register", (req, res) => {
  const { username, password } = req.body;
  if (usuarios.find((u) => u.username === username)) {
    return res
      .status(400)
      .json({ ok: false, mensaje: "Usuario ya existe" });
  }
  usuarios.push({ username, password });
  res.json({ ok: true });
});

// ✅ GUARDAR LEAD COMPLETO Y ORDENADO
app.post("/guardar-lead", (req, res) => {
  try {
    const { team, agent, producto, puntaje, cuenta, telefono, direccion, zip } = req.body;

    const nuevoLead = {
      FECHA: new Date().toLocaleString("es-MX"),
      AGENTE: agent,
      NÚMERO: telefono,
      SERVICIO: producto,
      PUNTOS: puntaje,
      CUENTA: cuenta,
      DIRECCIÓN: direccion,
      "ZIP CODE": zip,
      TEAM: team,
    };

    console.log("📥 Lead recibido:", nuevoLead);

    const archivo = "leads.xlsx";
    let datos = [];

    if (fs.existsSync(archivo)) {
      const workbook = XLSX.readFile(archivo);
      const hoja = workbook.Sheets[workbook.SheetNames[0]];
      datos = XLSX.utils.sheet_to_json(hoja);
    }

    // --- Validación de duplicados (robusta y definitiva) ---
    const ahora = new Date();
    const dosDiasMs = 2 * 24 * 60 * 60 * 1000;
    let duplicadosDebug = [];
    const normalizar = v => (typeof v === 'string' ? v.trim().toLowerCase() : (v||''));
    const esDuplicado = datos.some(lead => {
      // Normalizamos campos clave
      const telA = normalizar(lead["NÚMERO"]);
      const telB = normalizar(nuevoLead["NÚMERO"]);
      const cuentaA = normalizar(lead["CUENTA"]);
      const cuentaB = normalizar(nuevoLead["CUENTA"]);
      const prodA = normalizar(lead["SERVICIO"]);
      const prodB = normalizar(nuevoLead["SERVICIO"]);
      // Comparamos fechas (si existen y son válidas)
      let fechaLead = new Date(lead["FECHA"]);
      if (isNaN(fechaLead)) return false;
      const dentroDe2Dias = Math.abs(ahora - fechaLead) < dosDiasMs;
      // Debug: guarda info de comparación
      duplicadosDebug.push({telA, telB, cuentaA, cuentaB, prodA, prodB, fechaLead, dentroDe2Dias});
      // Consideramos duplicado si coincide teléfono y producto, o cuenta y producto, en los últimos 2 días
      return ((telA && telA === telB && prodA === prodB && dentroDe2Dias) || (cuentaA && cuentaA === cuentaB && prodA === prodB && dentroDe2Dias));
    });
    console.log('▶️ POST recibido a /guardar-lead:', nuevoLead);
    if (esDuplicado) {
      console.warn('⛔ Lead duplicado detectado. Comparaciones:', duplicadosDebug);
      return res.status(400).json({ ok: false, error: "Este lead ya fue registrado recientemente. Verifica antes de guardar." });
    } else {
      console.log('✅ Lead NO duplicado. Comparaciones:', duplicadosDebug);
    }

    datos.push(nuevoLead);

    // Ordenar por FECHA descendente
    datos.sort((a, b) => new Date(b.FECHA) - new Date(a.FECHA));

    // Ordenar columnas: aseguramos el orden y que todas existan
    const encabezados = ["FECHA", "AGENTE", "NÚMERO", "SERVICIO", "PUNTOS", "CUENTA", "DIRECCIÓN", "ZIP CODE", "TEAM"];
    const datosOrdenados = datos.map((item) => {
      const fila = {};
      encabezados.forEach((col) => {
        fila[col] = item[col] || "";
      });
      return fila;
    });

    const nuevaHoja = XLSX.utils.json_to_sheet(datosOrdenados, { header: encabezados });
    const nuevoLibro = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(nuevoLibro, nuevaHoja, "Leads");

    XLSX.writeFile(nuevoLibro, archivo);

    res.json({ ok: true });
  } catch (error) {
    console.error("❌ Error al guardar el lead:", error);
    res.status(500).json({ ok: false, mensaje: "Error interno del servidor" });
  }
});

// ✅ OBTENER LEADS DEL EXCEL - DESHABILITADO (usar routes/api.js del servidor principal)
// app.get("/api/leads", (req, res) => {
//   const archivo = "leads.xlsx";
//   if (!fs.existsSync(archivo)) {
//     return res.json([]);
//   }

//   try {
//     const workbook = XLSX.readFile(archivo);
//     const hoja = workbook.Sheets[workbook.SheetNames[0]];
//     const datos = XLSX.utils.sheet_to_json(hoja);
//     res.json(datos);
//   } catch (error) {
//     console.error("❌ Error al leer leads.xlsx:", error);
//     res.status(500).json({ ok: false, mensaje: "Error al leer leads.xlsx" });
//   }
// });

// Iniciar servidor
app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
});
