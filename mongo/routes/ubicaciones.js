// routes/ubicaciones.js
const express = require('express');
const router = express.Router();
const Direccion = require('../models/ubicacion');
const { verificarToken, soloCliente } = require('../../auth/jwt');

// Ruta GET para obtener las ubicaciones del usuario autenticado
router.get('/', verificarToken, async (req, res) => {
  try {
    const ubicaciones = await Direccion.find({ id_usuario: req.usuario.id });
    res.json(ubicaciones);
  } catch (err) {
    console.error('Error al obtener las ubicaciones:', err);
    res.status(500).json({ error: 'Error al obtener las ubicaciones' });
  }
});

// Ruta GET para obtener una ubicación por ID (asegurando que sea del usuario)
router.get('/:id', verificarToken, async (req, res) => {
  try {
    const ubicacion = await Direccion.findOne({ _id: req.params.id, id_usuario: req.usuario.id });
    if (!ubicacion) {
      return res.status(404).json({ error: 'Dirección no encontrada' });
    }
    res.json(ubicacion);
  } catch (err) {
    console.error('Error al obtener la dirección:', err);
    res.status(500).json({ error: 'Error al obtener la dirección' });
  }
});

// Ruta POST para guardar una nueva ubicación (asociada al usuario)
router.post('/', verificarToken, async (req, res) => {
  try {
    const nuevaDireccion = new Direccion({
      id_usuario: req.usuario.id, // ✅ Asociar con el usuario logueado
      nombreOrigen: req.body.nombreOrigen,
      nombreDestino: req.body.nombreDestino,
      coordenadasOrigen: req.body.coordenadasOrigen,
      coordenadasDestino: req.body.coordenadasDestino,
      rutaGeoJSON: req.body.rutaGeoJSON || undefined
    });

    await nuevaDireccion.save();
    res.status(201).json(nuevaDireccion);
  } catch (err) {
    console.error('Error al guardar la dirección:', err);
    res.status(500).json({ error: 'Error al guardar la dirección' });
  }
});

// Ruta PUT para actualizar una ubicación del usuario
router.put('/:id', verificarToken, async (req, res) => {
  try {
    const { nombreOrigen, nombreDestino, coordenadasOrigen, coordenadasDestino, rutaGeoJSON } = req.body;

    const direccionActualizada = await Direccion.findOneAndUpdate(
      { _id: req.params.id, id_usuario: req.usuario.id },
      {
        nombreOrigen,
        nombreDestino,
        coordenadasOrigen,
        coordenadasDestino,
        rutaGeoJSON: rutaGeoJSON || null
      },
      { new: true }
    );

    if (!direccionActualizada) {
      return res.status(404).json({ error: 'Dirección no encontrada o no autorizada' });
    }

    res.json(direccionActualizada);
  } catch (err) {
    console.error('Error al actualizar la dirección:', err);
    res.status(500).json({ error: 'Error al actualizar la dirección' });
  }
});

// Ruta DELETE para eliminar una ubicación del usuario
router.delete('/:id', verificarToken, async (req, res) => {
  try {
    const direccionEliminada = await Direccion.findOneAndDelete({ _id: req.params.id, id_usuario: req.usuario.id });
    if (!direccionEliminada) {
      return res.status(404).json({ error: 'Dirección no encontrada o no autorizada' });
    }
    res.json({ message: 'Dirección eliminada correctamente' });
  } catch (err) {
    console.error('Error al eliminar la dirección:', err);
    res.status(500).json({ error: 'Error al eliminar la dirección' });
  }
});

module.exports = router;
