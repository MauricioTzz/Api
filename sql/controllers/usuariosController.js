const { sql, poolPromise } = require('../../config/sqlserver');

// Ver todos los usuarios
async function obtenerTodos(req, res) {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query('SELECT * FROM Usuarios');
    res.json(result.recordset);
  } catch (err) {
    console.error('❌ Error al obtener usuarios:', err);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
}

// Ver usuario por ID
async function obtenerPorId(req, res) {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('id', sql.Int, req.params.id)
      .query('SELECT * FROM Usuarios WHERE id = @id');

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json(result.recordset[0]);
  } catch (err) {
    console.error('❌ Error al obtener usuario:', err);
    res.status(500).json({ error: 'Error al obtener usuario' });
  }
}

// Editar usuario (nombre, apellido, correo, rol)
async function editar(req, res) {
  const { nombre, apellido, correo, rol } = req.body;

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('id', sql.Int, req.params.id)
      .input('nombre', sql.NVarChar, nombre)
      .input('apellido', sql.NVarChar, apellido)
      .input('correo', sql.NVarChar, correo)
      .input('rol', sql.NVarChar, rol)
      .query(`UPDATE Usuarios SET nombre = @nombre, apellido = @apellido, correo = @correo, rol = @rol WHERE id = @id`);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json({ mensaje: 'Usuario actualizado correctamente' });
  } catch (err) {
    console.error('❌ Error al editar usuario:', err);
    res.status(500).json({ error: 'Error al editar usuario' });
  }
}

// Eliminar usuario
async function eliminar(req, res) {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('id', sql.Int, req.params.id)
      .query('DELETE FROM Usuarios WHERE id = @id');

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }

    res.json({ mensaje: 'Usuario eliminado correctamente' });
  } catch (err) {
    console.error('❌ Error al eliminar usuario:', err);
    res.status(500).json({ error: 'Error al eliminar usuario' });
  }
}

module.exports = {
  obtenerTodos,
  obtenerPorId,
  editar,
  eliminar
};
