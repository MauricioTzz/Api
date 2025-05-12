const express = require('express');
const router = express.Router();
const { obtenerQR } = require('../controllers/qrController');
const { verificarToken, soloTransportista } = require('../auth/jwt');

// ✅ Ruta para obtener el QR de una asignación, solo transportistas autenticados
router.get('/api/qr/:id_asignacion', verificarToken, soloTransportista, obtenerQR);

module.exports = router;
