// Script para buscar TODAS las ventas de Jairo Flores
print("==========================================");
print("🔍 BÚSQUEDA COMPLETA DE JAIRO FLORES");
print("==========================================");

// 1. Buscar ventas con Jairo Flores (exacto)
print("\n📋 Ventas con 'Jairo Flores':");
db.costumers.find({
  agenteNombre: "Jairo Flores"
}).forEach(function(lead, index) {
  print((index + 1) + ". ID: " + lead._id);
  print("   Cliente: " + (lead.nombre_cliente || "SIN NOMBRE"));
  print("   Status: " + (lead.status || "SIN STATUS"));
  print("   AgenteNombre: '" + (lead.agenteNombre || "SIN AGENTENOMBRE") + "'");
  print("   Agente: '" + (lead.agente || "SIN AGENTE") + "'");
  print("");
});

// 2. Buscar ventas con JAIRO IVAN FLORES PINO
print("\n📋 Ventas con 'JAIRO IVAN FLORES PINO':");
db.costumers.find({
  agenteNombre: "JAIRO IVAN FLORES PINO"
}).forEach(function(lead, index) {
  print((index + 1) + ". ID: " + lead._id);
  print("   Cliente: " + (lead.nombre_cliente || "SIN NOMBRE"));
  print("   Status: " + (lead.status || "SIN STATUS"));
  print("   AgenteNombre: '" + (lead.agenteNombre || "SIN AGENTENOMBRE") + "'");
  print("   Agente: '" + (lead.agente || "SIN AGENTE") + "'");
  print("");
});

// 3. Buscar con regex para encontrar cualquier variación
print("\n🔍 Búsqueda con regex (cualquier variación):");
db.costumers.find({
  agenteNombre: { $regex: /jairo.*flores/i, $options: "i" }
}).forEach(function(lead, index) {
  print((index + 1) + ". ID: " + lead._id);
  print("   Cliente: " + (lead.nombre_cliente || "SIN NOMBRE"));
  print("   Status: " + (lead.status || "SIN STATUS"));
  print("   AgenteNombre: '" + (lead.agenteNombre || "SIN AGENTENOMBRE") + "'");
  print("   Agente: '" + (lead.agente || "SIN AGENTE") + "'");
  print("");
});

// 4. Buscar también en campo agente
print("\n📋 Buscando en campo 'agente' con regex:");
db.costumers.find({
  agente: { $regex: /jairo.*flores/i, $options: "i" }
}).forEach(function(lead, index) {
  print((index + 1) + ". ID: " + lead._id);
  print("   Cliente: " + (lead.nombre_cliente || "SIN NOMBRE"));
  print("   Status: " + (lead.status || "SIN STATUS"));
  print("   AgenteNombre: '" + (lead.agenteNombre || "SIN AGENTENOMBRE") + "'");
  print("   Agente: '" + (lead.agente || "SIN AGENTE") + "'");
  print("");
});

// 5. Conteo total
print("\n==========================================");
print("📊 CONTEO TOTAL DE VENTAS");

var totalJairoFlores = db.costumers.countDocuments({agenteNombre: "Jairo Flores"});
var totalJairoIvan = db.costumers.countDocuments({agenteNombre: "JAIRO IVAN FLORES PINO"});
var totalRegexAgenteNombre = db.costumers.countDocuments({agenteNombre: { $regex: /jairo.*flores/i, $options: "i" }});
var totalRegexAgente = db.costumers.countDocuments({agente: { $regex: /jairo.*flores/i, $options: "i" }});

print("Jairo Flores (exacto): " + totalJairoFlores + " ventas");
print("JAIRO IVAN FLORES PINO (exacto): " + totalJairoIvan + " ventas");
print("Cualquier variación en agenteNombre: " + totalRegexAgenteNombre + " ventas");
print("Cualquier variación en agente: " + totalRegexAgente + " ventas");

print("\n==========================================");
print("✅ Búsqueda completada");
