const mongoose = require('mongoose');

const qrTokenSchema = new mongoose.Schema({
  id_asignacion: {
    type: Number,
    required: true,
    unique: true
  },
  token: {
    type: String,
    required: true,
    unique: true
  },
  imagenQR: {
    type: String,  // Almacenamos la imagen en base64
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
