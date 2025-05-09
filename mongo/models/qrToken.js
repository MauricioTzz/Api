// models/qrToken.js
const mongoose = require('mongoose');

const qrTokenSchema = new mongoose.Schema({
  id_asignacion: {
    type: Number,
    required: true,
    unique: true // Cada asignación solo puede tener un QR
  },
  id_usuario_cliente: {
    type: Number,
    required: true // El cliente asociado a la partición
  },
  token: {
    type: String,
    required: true,
    unique: true // El token debe ser único para cada QR
  },
  imagenQR: {
    type: String,  // Almacenamos la imagen en base64 (formato PNG)
    required: true
  },
  usado: {
    type: Boolean,
    default: false
  },
  fecha_creacion: {
    type: Date,
    default: Date.now
  },
  fecha_expiracion: {
    type: Date,
    required: true
  }
});

module.exports = mongoose.model('QrToken', qrTokenSchema);
