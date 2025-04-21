const express = require('express');
const router = express.Router();
const { verificarToken, soloAdmin } = require('../../auth/jwt');
const controller = require('../controllers/usuariosController');

router.get('/', verificarToken, soloAdmin, controller.obtenerTodos);
router.get('/clientes', verificarToken, soloAdmin, controller.obtenerClientes);
router.get('/:id', verificarToken, soloAdmin, controller.obtenerPorId);
router.put('/:id', verificarToken, soloAdmin, controller.editar);
router.delete('/:id', verificarToken, soloAdmin, controller.eliminar);

module.exports = router;
