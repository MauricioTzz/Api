const express = require('express');
const router = express.Router();
const controller = require('../controllers/tipoTransporteController');

router.get('/', controller.obtenerTodos);

module.exports = router;
