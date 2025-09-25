const mongoose = require('mongoose');

const mediaFileSchema = new mongoose.Schema({
  filename: {
    type: String,
    required: true
  },
  originalName: {
    type: String,
    required: true
  },
  mimetype: {
    type: String,
    required: true
  },
  size: {
    type: Number,
    required: true
  },
  path: {
    type: String,
    required: true
  },
  url: {
    type: String,
    required: true
  },
  uploadedBy: {
    type: String,
    required: true
  },
  uploadDate: {
    type: Date,
    default: Date.now
  },
  category: {
    type: String,
    enum: ['image', 'gif', 'video'],
    required: true
  },
  tags: [{
    type: String
  }],
  description: {
    type: String,
    default: ''
  }
}, {
  timestamps: true
});

// Índices para búsquedas eficientes
mediaFileSchema.index({ uploadedBy: 1 });
mediaFileSchema.index({ category: 1 });
mediaFileSchema.index({ uploadDate: -1 });

module.exports = mongoose.model('MediaFile', mediaFileSchema);
