const express = require('express');
const router = express.Router();
const { verificarToken, soloAdmin } = require('../../auth/jwt');
const controller = require('../controllers/transportistasController');

router.get('/', verificarToken, soloAdmin, controller.obtenerTodos);
router.get('/:id', verificarToken, soloAdmin, controller.obtenerPorId);
router.post('/', verificarToken, soloAdmin, controller.crear);
router.put('/:id', verificarToken, soloAdmin, controller.editar);
router.delete('/:id', verificarToken, soloAdmin, controller.eliminar);
router.post('/crear-completo', verificarToken, soloAdmin, controller.crearTransportistaCompleto);

module.exports = router;
