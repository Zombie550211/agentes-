// Script para ejecutar en MongoDB Compass
// Actualiza puntajes en leads de Diciembre 2025

// PASO 1: Actualizar XFINITY Double Play (0.95 → 1.00)
db.leads.updateMany(
  {
    service: "XFINITY Double Play",
    "scores.base": 0.95,
    createdAt: {
      $gte: new Date("2025-12-01"),
      $lt: new Date("2026-01-01")
    }
  },
  {
    $set: {
      "scores.base": 1.00,
      updatedAt: new Date()
    }
  }
);

// PASO 2: Actualizar AT&T Internet Air 90-300Mbps (0.35 → 0.45)
db.leads.updateMany(
  {
    service: "AT&T Internet Air 90-300Mbps",
    "scores.base": 0.35,
    createdAt: {
      $gte: new Date("2025-12-01"),
      $lt: new Date("2026-01-01")
    }
  },
  {
    $set: {
      "scores.base": 0.45,
      updatedAt: new Date()
    }
  }
);

// PASO 3: Ver los cambios realizados
db.leads.find({
  createdAt: {
    $gte: new Date("2025-12-01"),
    $lt: new Date("2026-01-01")
  },
  $or: [
    { service: "XFINITY Double Play" },
    { service: "AT&T Internet Air 90-300Mbps" }
  ]
}).projection({
  agenteNombre: 1,
  createdAt: 1,
  service: 1,
  "scores.base": 1
});
