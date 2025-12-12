// Script para ejecutar en mongosh
// Actualiza puntajes en leads de Diciembre 2025

use crm;

console.log("================================");
console.log("ACTUALIZACIÓN DE PUNTAJES - DICIEMBRE 2025");
console.log("================================\n");

// PASO 1: Actualizar XFINITY Double Play (0.95 → 1.00)
console.log("1. Actualizando XFINITY Double Play (0.95 → 1.00)...\n");

const xfinityResult = db.leads.updateMany(
  {
    servicios: "xfinity-double-play",
    puntaje: 0.95,
    creadoEn: {
      $gte: new Date("2025-12-01"),
      $lt: new Date("2026-01-01")
    }
  },
  {
    $set: {
      puntaje: 1.00,
      actualizadoEn: new Date()
    }
  }
);

console.log("   Documentos coincidentes: " + xfinityResult.matchedCount);
console.log("   Documentos actualizados: " + xfinityResult.modifiedCount + "\n");

// PASO 2: Actualizar AT&T Internet Air (0.35 → 0.45)
console.log("2. Actualizando AT&T Internet Air (0.35 → 0.45)...\n");

const attResult = db.leads.updateMany(
  {
    servicios: "att-air",
    puntaje: 0.35,
    creadoEn: {
      $gte: new Date("2025-12-01"),
      $lt: new Date("2026-01-01")
    }
  },
  {
    $set: {
      puntaje: 0.45,
      actualizadoEn: new Date()
    }
  }
);

console.log("   Documentos coincidentes: " + attResult.matchedCount);
console.log("   Documentos actualizados: " + attResult.modifiedCount + "\n");

// PASO 3: Mostrar los cambios realizados
console.log("================================");
console.log("REPORTE DE CAMBIOS");
console.log("================================\n");

const xfinityUpdated = db.leads.find({
  servicios: "xfinity-double-play",
  puntaje: 1.00,
  creadoEn: {
    $gte: new Date("2025-12-01"),
    $lt: new Date("2026-01-01")
  }
}).toArray();

const attUpdated = db.leads.find({
  servicios: "att-air",
  puntaje: 0.45,
  creadoEn: {
    $gte: new Date("2025-12-01"),
    $lt: new Date("2026-01-01")
  }
}).toArray();

console.log("XFINITY Double Play (1.00):");
console.log("AGENTE | FECHA VENTA\n");
xfinityUpdated.forEach(lead => {
  const fecha = lead.creadoEn.toISOString().split('T')[0];
  console.log(lead.agenteNombre + " | " + fecha);
});

console.log("\n\nAT&T Internet Air (0.45):");
console.log("AGENTE | FECHA VENTA\n");
attUpdated.forEach(lead => {
  const fecha = lead.creadoEn.toISOString().split('T')[0];
  console.log(lead.agenteNombre + " | " + fecha);
});

console.log("\n================================");
console.log("RESUMEN FINAL");
console.log("================================");
console.log("Total XFINITY actualizados: " + xfinityUpdated.length);
console.log("Total AT&T actualizados: " + attUpdated.length);
console.log("TOTAL: " + (xfinityUpdated.length + attUpdated.length));
console.log("================================\n");
