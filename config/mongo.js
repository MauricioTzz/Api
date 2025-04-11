const mongoose = require('mongoose');

module.exports = function conectarMongo() {
  mongoose.connect('mongodb+srv://Mauricio:prueba123@cluster0.lpavecb.mongodb.net/orgtrack?retryWrites=true&w=majority&appName=Cluster0')
    .then(() => console.log('Conectado a MongoDB Atlas'))
    .catch(err => console.error('Error al conectar a MongoDB Atlas', err));
};
