const mongoose = require('mongoose');

const leadSchema = new mongoose.Schema({
  nombre_cliente: String,
  telefono: String,
  telefono_principal: String,
  direccion: String,
  tipo_servicio: String,
  servicios: String,
  servicios_texto: String,
  sistema: String,
  mercado: String,
  riesgo: String,
  autopago: Boolean,
  dia_venta: String,
  team: { type: String, index: true },
  supervisor: String,
  agente: String,
  dia_instalacion: String,
  puntaje: Number,
  zip: String,
  creadoEn: { type: Date, default: Date.now, index: true },
  actualizadoEn: { type: Date, default: Date.now },
  producto_contratado: String,
  fecha_contratacion: String,
  equipo: { type: String, index: true },
  status: String,
  comentario: String,
  motivo_llamada: String,
  numero_cuenta: String,
  agenteId: mongoose.Schema.Types.ObjectId,
  creadoPor: String,
  agenteNombre: String,
  ownerId: String,
  registeredById: mongoose.Schema.Types.ObjectId
});

// Índices para mejorar el rendimiento de las consultas
leadSchema.index({ team: 1, mercado: 1 });
leadSchema.index({ creadoEn: 1, team: 1 });
leadSchema.index({ mercado: 1 });

module.exports = mongoose.models.Lead || mongoose.model('Lead', leadSchema);
