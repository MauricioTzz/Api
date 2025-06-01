// models/firmaTransportista.js
const mongoose = require('mongoose');

const firmaTransportistaSchema = new mongoose.Schema({
  id_asignacion: {
    type: Number,
    required: true,
    unique: true
  },
  imagenFirma: {
    type: String,
    required: true
  },
  fechaFirma: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('FirmaTransportista', firmaTransportistaSchema);
