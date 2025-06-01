const express = require('express');
const router = express.Router();
const { guardarFirmaTransportista } = require('../controllers/firmaTransportistaController');

// Firma del transportista (sin autenticación)
router.post('/firma-transportista/:id_asignacion', guardarFirmaTransportista);
router.get('/firma-transportista/:id_asignacion', obtenerFirmaPorAsignacion);

module.exports = router;
