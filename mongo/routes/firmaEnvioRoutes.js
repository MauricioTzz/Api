const express = require('express');
const router = express.Router();
const { guardarFirmaEnvio } = require('../controllers/firmaEnvioController');

// Endpoint para guardar firma del cliente por asignación
router.post('/firma/:id_asignacion', guardarFirmaEnvio);

module.exports = router;
