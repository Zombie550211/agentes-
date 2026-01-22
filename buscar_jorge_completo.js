// Script completo para buscar TODAS las ventas de Jorge Segovia
print("==========================================");
print("🔍 BÚSQUEDA COMPLETA DE JORGE SEGOVIA");
print("==========================================");

// Buscar con todos los campos posibles donde podría estar el nombre
print("\n📋 Buscando en campo agenteNombre...");
var ventasAgenteNombre = db.costumers.find({
  agenteNombre: { $regex: /jorge.*segovia/i, $options: "i" }
}).toArray();

print("Encontradas: " + ventasAgenteNombre.length + " ventas");

ventasAgenteNombre.forEach(function(lead, index) {
  print((index + 1) + ". ID: " + lead._id);
  print("   Cliente: " + (lead.nombre_cliente || "SIN NOMBRE"));
  print("   Teléfono: " + (lead.telefono_principal || "SIN TELÉFONO"));
  print("   Status: " + (lead.status || "SIN STATUS"));
  print("   Fecha: " + (lead.dia_venta || "SIN FECHA"));
  print("   Team: " + (lead.team || "SIN TEAM"));
  print("   AgenteNombre: '" + (lead.agenteNombre || "SIN AGENTENOMBRE") + "'");
  print("   Agente: '" + (lead.agente || "SIN AGENTE") + "'");
  print("");
});

print("\n📋 Buscando en campo agente...");
var ventasAgente = db.costumers.find({
  agente: { $regex: /jorge.*segovia/i, $options: "i" }
}).toArray();

print("Encontradas: " + ventasAgente.length + " ventas");

ventasAgente.forEach(function(lead, index) {
  print((index + 1) + ". ID: " + lead._id);
  print("   Cliente: " + (lead.nombre_cliente || "SIN NOMBRE"));
  print("   Teléfono: " + (lead.telefono_principal || "SIN TELÉFONO"));
  print("   Status: " + (lead.status || "SIN STATUS"));
  print("   Fecha: " + (lead.dia_venta || "SIN FECHA"));
  print("   Team: " + (lead.team || "SIN TEAM"));
  print("   AgenteNombre: '" + (lead.agenteNombre || "SIN AGENTENOMBRE") + "'");
  print("   Agente: '" + (lead.agente || "SIN AGENTE") + "'");
  print("");
});

// Combinar todos los resultados (sin duplicados)
print("\n🔍 COMBINANDO TODOS LOS RESULTADOS...");
var todasLasVentas = [...ventasAgenteNombre, ...ventasAgente];

// Eliminar duplicados por ID
var ventasUnicas = todasLasVentas.filter((venta, index, self) => 
  index === self.findIndex(v => v._id.toString() === venta._id.toString())
);

print("Total combinado: " + todasLasVentas.length);
print("Total sin duplicados: " + ventasUnicas.length);

print("\n📊 RESUMEN FINAL:");
print("==========================================");
ventasUnicas.forEach(function(lead, index) {
  print((index + 1) + ". ID: " + lead._id);
  print("   Cliente: " + (lead.nombre_cliente || "SIN NOMBRE"));
  print("   Teléfono: " + (lead.telefono_principal || "SIN TELÉFONO"));
  print("   Status: " + (lead.status || "SIN STATUS"));
  print("   Fecha: " + (lead.dia_venta || "SIN FECHA"));
  print("   Team: " + (lead.team || "SIN TEAM"));
  print("   AgenteNombre: '" + (lead.agenteNombre || "SIN AGENTENOMBRE") + "'");
  print("   Agente: '" + (lead.agente || "SIN AGENTE") + "'");
  print("");
});

print("==========================================");
print("✅ TOTAL DE VENTAS ENCONTRADAS: " + ventasUnicas.length);
print("==========================================");
