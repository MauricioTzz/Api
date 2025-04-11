const express = require('express');
const router = express.Router();
const { verificarToken } = require('../../auth/jwt');
const controller = require('../controllers/recogidaEntregaController');

router.post('/', verificarToken, controller.crear); 

module.exports = router;
