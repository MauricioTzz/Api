const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { sql, poolPromise } = require('../config/sqlserver');
const { SECRET_KEY } = require('./jwt');

// Registro (solo clientes)
async function register(req, res) {
  const { nombre, apellido, correo, contrasena } = req.body;
  if (!nombre || !apellido || !correo || !contrasena) {
    return res.status(400).json({ error: 'Todos los campos son obligatorios' });
  }

  try {
    const pool = await poolPromise;
    const userCheck = await pool.request()
      .input('correo', sql.NVarChar, correo)
      .query('SELECT * FROM Usuarios WHERE correo = @correo');

    if (userCheck.recordset.length > 0) {
      return res.status(409).json({ error: 'El correo ya está registrado' });
    }

    const hashedPassword = await bcrypt.hash(contrasena, 10);
    await pool.request()
      .input('nombre', sql.NVarChar, nombre)
      .input('apellido', sql.NVarChar, apellido)
      .input('correo', sql.NVarChar, correo)
      .input('contrasena', sql.NVarChar, hashedPassword)
      .input('rol', sql.NVarChar, 'cliente')
      .query('INSERT INTO Usuarios (nombre, apellido, correo, contrasena, rol) VALUES (@nombre, @apellido, @correo, @contrasena, @rol)');

    res.status(201).json({ mensaje: 'Cliente registrado correctamente' });
  } catch (err) {
    console.error('Error en registro:', err);
    res.status(500).json({ error: 'Error en el servidor al registrar' });
  }
}

// Login general
async function login(req, res) {
  const { correo, contrasena } = req.body;

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('correo', sql.NVarChar, correo)
      .query('SELECT * FROM Usuarios WHERE correo = @correo');

    const usuario = result.recordset[0];
    if (!usuario) return res.status(401).json({ error: 'Credenciales inválidas' });

    const passwordMatch = await bcrypt.compare(contrasena, usuario.contrasena);
    if (!passwordMatch) return res.status(401).json({ error: 'Credenciales inválidas' });

    const token = jwt.sign({ id: usuario.id, rol: usuario.rol }, SECRET_KEY, { expiresIn: '4h' });
    res.json({ token, usuario: { id: usuario.id, nombre: usuario.nombre, rol: usuario.rol } });
  } catch (err) {
    console.error('Error en login:', err);
    res.status(500).json({ error: 'Error en el servidor al iniciar sesión' });
  }
}

module.exports = {
  login,
  register
};
