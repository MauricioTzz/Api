const express = require('express');
const router = express.Router();
const Direccion = require('../models/ubicacion');

// Ruta GET para obtener todas las ubicaciones
router.get('/', async (req, res) => {
  try {
    const ubicaciones = await Direccion.find(); 
    res.json(ubicaciones); 
  } catch (err) {
    console.error('Error al obtener las ubicaciones:', err);
    res.status(500).json({ error: 'Error al obtener las ubicaciones' });
  }
});

// Ruta GET para obtener una ubicación por ID
router.get('/:id', async (req, res) => {
  try {
    const ubicacion = await Direccion.findById(req.params.id);
    if (!ubicacion) {
      return res.status(404).json({ error: 'Dirección no encontrada' });
    }
    res.json(ubicacion);  
  } catch (err) {
    console.error('Error al obtener la dirección:', err);
    res.status(500).json({ error: 'Error al obtener la dirección' });
  }
});

// Ruta POST para guardar una nueva ubicación
router.post('/', async (req, res) => {
  try {
    const nuevaDireccion = new Direccion({
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

// Ruta PUT para actualizar una ubicación existente
router.put('/:id', async (req, res) => {
  try {
    const { nombreOrigen, nombreDestino, coordenadasOrigen, coordenadasDestino, rutaGeoJSON } = req.body;

    const direccionActualizada = await Direccion.findByIdAndUpdate(
      req.params.id,
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
      return res.status(404).json({ error: 'Dirección no encontrada' });
    }

    res.json(direccionActualizada);
  } catch (err) {
    console.error('Error al actualizar la dirección:', err);
    res.status(500).json({ error: 'Error al actualizar la dirección' });
  }
});

// Ruta DELETE para eliminar una ubicación existente
router.delete('/:id', async (req, res) => {
  try {
    const direccionEliminada = await Direccion.findByIdAndDelete(req.params.id);
    if (!direccionEliminada) {
      return res.status(404).json({ error: 'Dirección no encontrada' });
    }
    res.json({ message: 'Dirección eliminada correctamente' });
  } catch (err) {
    console.error('Error al eliminar la dirección:', err);
    res.status(500).json({ error: 'Error al eliminar la dirección' });
  }
});

module.exports = router;
