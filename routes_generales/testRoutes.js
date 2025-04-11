const express = require('express');
const router = express.Router();
const { verificarToken, soloAdmin, soloCliente } = require('../auth/jwt');

router.get('/admin', verificarToken, soloAdmin, (req, res) => {
  res.json({ mensaje: `Hola ADMIN ${req.usuario.id}, acceso permitido.` });
});

router.get('/cliente', verificarToken, soloCliente, (req, res) => {
  res.json({ mensaje: `Hola CLIENTE ${req.usuario.id}, acceso permitido.` });
});

module.exports = router;
