const mongoose = require('mongoose');

const firmaEnvioSchema = new mongoose.Schema({
  id_asignacion: {
    type: Number, // Este es el ID de AsignacionMultiple en SQL Server
    required: true,
    unique: true // No puedes tener dos firmas para la misma asignación
  },
  imagenFirma: {
    type: String, // Imagen de la firma en base64
    required: true
  },
  fechaFirma: {
    type: Date,
    default: Date.now
  }
});

module.exports = mongoose.model('FirmaEnvio', firmaEnvioSchema);
