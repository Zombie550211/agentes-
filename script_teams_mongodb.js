// Script para MongoDB Compass - Conteo de Teams y Agentes Asignados
// Colección: users
// Base de datos: dashboard

// Pipeline para agrupar por supervisor y contar agentes
db.users.aggregate([
  // Filtrar solo agentes (excluir supervisores y otros roles)
  {
    $match: {
      role: { $regex: /agente/i, $options: "i" }
    }
  },
  
  // Agrupar por supervisor
  {
    $group: {
      _id: "$supervisor",
      agentes: {
        $push: {
          username: "$username",
          name: "$name",
          email: "$email",
          role: "$role"
        }
      },
      totalAgentes: { $sum: 1 }
    }
  },
  
  // Ordenar por cantidad de agentes (descendente)
  {
    $sort: { totalAgentes: -1 }
  },
  
  // Formatear salida
  {
    $project: {
      supervisor: "$_id",
      totalAgentes: 1,
      agentes: 1,
      _id: 0
    }
  }
]).forEach(function(doc) {
  print("=".repeat(60));
  print("📊 TEAM: " + (doc.supervisor || "SIN SUPERVISOR"));
  print("👥 Total Agentes: " + doc.totalAgentes);
  print("📋 Lista de Agentes:");
  
  doc.agentes.forEach(function(agente, index) {
    var nombre = agente.name || agente.username || "SIN NOMBRE";
    var email = agente.email || "SIN EMAIL";
    print("   " + (index + 1) + ". " + nombre + " (" + email + ")");
  });
  print("");
});

// Resumen general
print("=".repeat(60));
print("📈 RESUMEN GENERAL");

var totalAgentes = db.users.countDocuments({role: { $regex: /agente/i, $options: "i" }});
var totalSupervisores = db.users.distinct("supervisor", {role: { $regex: /agente/i, $options: "i" }}).length;

print("🔢 Total de Agentes en el sistema: " + totalAgentes);
print("👨‍💼 Total de Supervisores con agentes asignados: " + totalSupervisores);

// Mostrar también supervisores sin agentes
print("\n🔍 Supervisores registrados (sin filtro de agentes):");
db.users.find({role: { $regex: /supervisor/i, $options: "i" }}).forEach(function(sup) {
  print("   - " + (sup.name || sup.username || "SIN NOMBRE") + " (" + (sup.email || "SIN EMAIL") + ")");
});

print("=".repeat(60));
print("✅ Script ejecutado correctamente");
