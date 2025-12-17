// Script para MongoDB Compass / mongosh
// Ejecutar en la terminal de MongoDB Compass o mongosh

// 1. Buscar el registro específico de DANIELA SANTIAGO de Anderson en diciembre 2025
db.costumers.findOne({
  agenteNombre: "Anderson Guzman",
  nombre_cliente: /DANIELA SANTIAGO/i,
  dia_venta: "2025-12-15",
  puntaje: 0.75,
  servicios: "xfinity-500-plus"
})
