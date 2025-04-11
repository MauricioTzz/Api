const express = require('express');
const router = express.Router();
const authController = require('./authController');

router.post('/login', authController.login);
router.post('/register', authController.register); // solo clientes

module.exports = router;
