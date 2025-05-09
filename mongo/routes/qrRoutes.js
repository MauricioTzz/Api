const express = require('express');
const router = express.Router();
const { verificarToken } = require('../../auth/jwt');
const { generarQR, validarQR, marcarQRUsado } = require('../controllers/qrController');

// Ruta para generar QR (solo transportista)
router.post('/generar/:id_asignacion', verificarToken, generarQR);

// Ruta para validar QR y obtener detalles de la partición usando el token
router.get('/validar/:token', verificarToken, validarQR);  // 🔄 Ahora usa el token en lugar del id_asignacion

// Ruta para marcar QR como usado (cuando se firma) usando el token
router.put('/marcar-usado/:token', verificarToken, marcarQRUsado);

module.exports = router;
