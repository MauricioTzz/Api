const express = require('express');
const router = express.Router();
const { verificarToken, soloAdmin } = require('../../auth/jwt');
const enviosAdminController = require('../controllers/enviosAdminController');

// Crear un nuevo envío completo (con múltiples cargas y asignaciones)
router.post('/crear-completo', verificarToken, soloAdmin, enviosAdminController.crearEnvioCompletoAdmin);
router.get('/buscar-cliente', verificarToken, soloAdmin, enviosAdminController.buscarCliente);
router.get('/historial/:id_usuario', verificarToken, soloAdmin, enviosAdminController.obtenerHistorialCliente);
router.get('/reutilizar/:id_envio', verificarToken, soloAdmin, enviosAdminController.reutilizarEnvioAnterior);


module.exports = router;