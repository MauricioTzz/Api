// /auth/jwt.js
const jwt = require('jsonwebtoken');
const SECRET_KEY = 'OrgTrackSuperSecreta2025'; // Reemplazar por una variable de entorno en producción

// Middleware: verifica si el token es válido
function verificarToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Token no proporcionado' });

  jwt.verify(token, SECRET_KEY, (err, usuario) => {
    if (err) return res.status(403).json({ error: 'Token inválido' });
    req.usuario = usuario; // { id, rol }
    next();
  });
}

// Middleware: verifica si el usuario tiene rol admin
function soloAdmin(req, res, next) {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ error: 'Acceso restringido a administradores' });
  next();
}

// Middleware: verifica si el usuario es cliente
function soloCliente(req, res, next) {
  if (req.usuario.rol !== 'cliente') return res.status(403).json({ error: 'Acceso solo para clientes' });
  next();
}

// Middleware: verifica si el usuario es transportista
function soloTransportista(req, res, next) {
  if (req.usuario.rol !== 'transportista') return res.status(403).json({ error: 'Acceso solo para transportistas' });
  next();
}

module.exports = {
  verificarToken,
  soloAdmin,
  soloCliente,
  soloTransportista,
  SECRET_KEY
};
