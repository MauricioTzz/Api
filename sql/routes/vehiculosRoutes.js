const express = require('express');
const router = express.Router();
const { verificarToken, soloAdmin } = require('../../auth/jwt');
const vehiculoController = require('../controllers/vehiculosController');

router.get('/', verificarToken, soloAdmin, vehiculoController.obtenerTodos);
router.get('/:id', verificarToken, soloAdmin, vehiculoController.obtenerPorId);
router.post('/', verificarToken, soloAdmin, vehiculoController.crear);
router.put('/:id', verificarToken, soloAdmin, vehiculoController.editar);
router.delete('/:id', verificarToken, soloAdmin, vehiculoController.eliminar);

module.exports = router;
