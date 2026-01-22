// Script para buscar ventas de JORGE.SERGOVIA / Jorge Segovia
// Copiar y pegar en MongoDB Compass

print("==========================================");
print("🔍 BUSCANDO VENTAS DE JORGE.SERGOVIA / Jorge Segovia");
print("==========================================");

// 1. Buscar ventas con JORGE.SERGOVIA (exacto)
print("\n📋 Ventas con 'JORGE.SERGOVIA':");
db.costumers.find({
  agenteNombre: "JORGE.SERGOVIA"
}).forEach(function(lead, index) {
  print((index + 1) + ". ID: " + lead._id);
  print("   Cliente: " + (lead.nombre_cliente || "SIN NOMBRE"));
  print("   Telefono: " + (lead.telefono_principal || "SIN TELÉFONO"));
  print("   Status: " + (lead.status || "SIN STATUS"));
  print("   Fecha Venta: " + (lead.dia_venta || "SIN FECHA"));
  print("   Team: " + (lead.team || "SIN TEAM"));
  print("   Supervisor: " + (lead.supervisor || "SIN SUPERVISOR"));
  print("   Agente: " + (lead.agente || "SIN AGENTE"));
  print("   AgenteNombre: " + (lead.agenteNombre || "SIN AGENTENOMBRE"));
  print("");
});

// 2. Buscar ventas con Jorge Segovia (con espacios)
print("\n📋 Ventas con 'Jorge Segovia':");
db.costumers.find({
  agenteNombre: "Jorge Segovia"
}).forEach(function(lead, index) {
  print((index + 1) + ". ID: " + lead._id);
  print("   Cliente: " + (lead.nombre_cliente || "SIN NOMBRE"));
  print("   Telefono: " + (lead.telefono_principal || "SIN TELÉFONO"));
  print("   Status: " + (lead.status || "SIN STATUS"));
  print("   Fecha Venta: " + (lead.dia_venta || "SIN FECHA"));
  print("   Team: " + (lead.team || "SIN TEAM"));
  print("   Supervisor: " + (lead.supervisor || "SIN SUPERVISOR"));
  print("   Agente: " + (lead.agente || "SIN AGENTE"));
  print("   AgenteNombre: " + (lead.agenteNombre || "SIN AGENTENOMBRE"));
  print("");
});

// 3. Buscar ventas con jorge segovia (minúsculas)
print("\n📋 Ventas con 'jorge segovia' (minúsculas):");
db.costumers.find({
  agenteNombre: "jorge segovia"
}).forEach(function(lead, index) {
  print((index + 1) + ". ID: " + lead._id);
  print("   Cliente: " + (lead.nombre_cliente || "SIN NOMBRE"));
  print("   Telefono: " + (lead.telefono_principal || "SIN TELÉFONO"));
  print("   Status: " + (lead.status || "SIN STATUS"));
  print("   Fecha Venta: " + (lead.dia_venta || "SIN FECHA"));
  print("   Team: " + (lead.team || "SIN TEAM"));
  print("   Supervisor: " + (lead.supervisor || "SIN SUPERVISOR"));
  print("   Agente: " + (lead.agente || "SIN AGENTE"));
  print("   AgenteNombre: " + (lead.agenteNombre || "SIN AGENTENOMBRE"));
  print("");
});

// 4. Buscar con regex para encontrar cualquier variación
print("\n🔍 Búsqueda con regex (cualquier variación):");
db.costumers.find({
  agenteNombre: { $regex: /jorge.*segovia/i, $options: "i" }
}).forEach(function(lead, index) {
  print((index + 1) + ". ID: " + lead._id);
  print("   Cliente: " + (lead.nombre_cliente || "SIN NOMBRE"));
  print("   Telefono: " + (lead.telefono_principal || "SIN TELÉFONO"));
  print("   Status: " + (lead.status || "SIN STATUS"));
  print("   Fecha Venta: " + (lead.dia_venta || "SIN FECHA"));
  print("   Team: " + (lead.team || "SIN TEAM"));
  print("   Supervisor: " + (lead.supervisor || "SIN SUPERVISOR"));
  print("   Agente: " + (lead.agente || "SIN AGENTE"));
  print("   AgenteNombre: '" + (lead.agenteNombre || "SIN AGENTENOMBRE") + "'");
  print("");
});

// 5. Conteo total
print("\n==========================================");
print("📊 CONTEO TOTAL DE VENTAS");

var totalExacto = db.costumers.countDocuments({agenteNombre: "JORGE.SERGOVIA"});
var totalConEspacios = db.costumers.countDocuments({agenteNombre: "Jorge Segovia"});
var totalMinusculas = db.costumers.countDocuments({agenteNombre: "jorge segovia"});
var totalRegex = db.costumers.countDocuments({agenteNombre: { $regex: /jorge.*segovia/i, $options: "i" }});

print("JORGE.SERGOVIA (exacto): " + totalExacto + " ventas");
print("Jorge Segovia (con espacios): " + totalConEspacios + " ventas");
print("jorge segovia (minúsculas): " + totalMinusculas + " ventas");
print("Cualquier variación (regex): " + totalRegex + " ventas");

print("\n==========================================");
print("✅ Búsqueda completada");
