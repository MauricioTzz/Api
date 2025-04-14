const mongoose = require('mongoose');

const direccionSchema = new mongoose.Schema({
  id_usuario: {
    type: Number, // ✅ Es el ID del usuario desde SQL Server
    required: true
  },

  nombreOrigen: String,
  coordenadasOrigen: [Number],
  nombreDestino: String,
  coordenadasDestino: [Number],

  segmentos: [
    {
      type: {
        type: String,
        default: "LineString",  
      },
      coordinates: [[Number]] 
    }
  ],
  rutaGeoJSON: {
    type: { type: String },
    coordinates: [[Number]]
  }
});

module.exports = mongoose.model('Direccion', direccionSchema);
