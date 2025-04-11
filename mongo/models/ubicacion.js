const mongoose = require('mongoose');

const direccionSchema = new mongoose.Schema({
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
