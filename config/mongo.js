const mongoose = require('mongoose');

module.exports = function conectarMongo() {
  mongoose.connect(process.env.MONGO_URI)
    .then(() => console.log('Conectado a MongoDB Atlas'))
    .catch(err => console.error('Error al conectar a MongoDB Atlas', err));
};
