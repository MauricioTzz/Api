// routes/ubicaciones.js
const express = require('express');
const router = express.Router();
const Direccion = require('../models/ubicacion');
const { verificarToken, soloCliente } = require('../../auth/jwt');
const { sql, poolPromise } = require('../../config/sqlserver');

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
      id_usuario: req.usuario.id, // Asociar con el usuario logueado
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

// Ruta DELETE para eliminar una ubicación del usuario con validación de uso
router.delete('/:id', verificarToken, async (req, res) => {
  const idDireccion = req.params.id;
  const idUsuario = req.usuario.id;

  try {
    // Validar si la dirección pertenece al usuario
    const direccion = await Direccion.findOne({ _id: idDireccion, id_usuario: idUsuario });
    if (!direccion) {
      return res.status(404).json({ error: 'Dirección no encontrada o no autorizada' });
    }

    // Verificar si está siendo usada por un envío activo
    const pool = await poolPromise;
    const result = await pool.request()
      .input('id_mongo', sql.NVarChar, idDireccion)
      .query(`
        SELECT COUNT(*) as cantidad 
        FROM Envios 
        WHERE id_ubicacion_mongo = @id_mongo 
        AND estado IN ('Pendiente', 'Asignado', 'En curso')
      `);

    if (result.recordset[0].cantidad > 0) {
      return res.status(400).json({
        error: 'Esta dirección está en uso por un envío activo y no puede eliminarse.'
      });
    }

    // Eliminar si no está en uso
    await Direccion.findByIdAndDelete(idDireccion);
    res.json({ message: 'Dirección eliminada correctamente' });

  } catch (err) {
    console.error('Error al eliminar la dirección:', err);
    res.status(500).json({ error: 'Error al eliminar la dirección' });
  }
});

module.exports = router;
