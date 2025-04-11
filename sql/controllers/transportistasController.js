// sql/controllers/transportistasController.js
const { sql, poolPromise } = require('../../config/sqlserver');

// Obtener todos los transportistas
async function obtenerTodos(req, res) {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query('SELECT * FROM Transportistas');
    res.json(result.recordset);
  } catch (err) {
    console.error('❌ Error al obtener transportistas:', err);
    res.status(500).json({ error: 'Error al obtener transportistas' });
  }
}

// Obtener transportista por ID
async function obtenerPorId(req, res) {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('id', sql.Int, req.params.id)
      .query('SELECT * FROM Transportistas WHERE id = @id');

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Transportista no encontrado' });
    }

    res.json(result.recordset[0]);
  } catch (err) {
    console.error('❌ Error al obtener transportista:', err);
    res.status(500).json({ error: 'Error al obtener transportista' });
  }
}

// Crear transportista
async function crear(req, res) {
  const { id_usuario, ci, telefono, estado } = req.body;
  if (!id_usuario || !ci || !estado) {
    return res.status(400).json({ error: 'Faltan datos obligatorios' });
  }

  try {
    const pool = await poolPromise;
    await pool.request()
      .input('id_usuario', sql.Int, id_usuario)
      .input('ci', sql.NVarChar, ci)
      .input('telefono', sql.NVarChar, telefono || null)
      .input('estado', sql.NVarChar, estado)
      .query(`INSERT INTO Transportistas (id_usuario, ci, telefono, estado)
              VALUES (@id_usuario, @ci, @telefono, @estado)`);

    res.status(201).json({ mensaje: 'Transportista creado correctamente' });
  } catch (err) {
    console.error('❌ Error al crear transportista:', err);
    res.status(500).json({ error: 'Error al crear transportista' });
  }
}

// Editar transportista
async function editar(req, res) {
  const { ci, telefono, estado } = req.body;

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('id', sql.Int, req.params.id)
      .input('ci', sql.NVarChar, ci)
      .input('telefono', sql.NVarChar, telefono || null)
      .input('estado', sql.NVarChar, estado)
      .query(`UPDATE Transportistas SET ci = @ci, telefono = @telefono, estado = @estado 
              WHERE id = @id`);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Transportista no encontrado' });
    }

    res.json({ mensaje: 'Transportista actualizado correctamente' });
  } catch (err) {
    console.error('❌ Error al editar transportista:', err);
    res.status(500).json({ error: 'Error al editar transportista' });
  }
}

// Eliminar transportista
async function eliminar(req, res) {
  try {
    const pool = await poolPromise;

    // Obtener el id_usuario antes de eliminar
    const getUsuario = await pool.request()
      .input('id', sql.Int, req.params.id)
      .query('SELECT id_usuario FROM Transportistas WHERE id = @id');

    if (getUsuario.recordset.length === 0) {
      return res.status(404).json({ error: 'Transportista no encontrado' });
    }

    const id_usuario = getUsuario.recordset[0].id_usuario;

    // Eliminar transportista
    await pool.request()
      .input('id', sql.Int, req.params.id)
      .query('DELETE FROM Transportistas WHERE id = @id');

    // Eliminar usuario
    await pool.request()
      .input('id_usuario', sql.Int, id_usuario)
      .query('DELETE FROM Usuarios WHERE id = @id_usuario');

    res.json({ mensaje: 'Transportista y usuario eliminados correctamente' });
  } catch (err) {
    console.error('❌ Error al eliminar transportista:', err);
    res.status(500).json({ error: 'Error al eliminar transportista' });
  }
}

// Crear Transportista COMPLETO 
async function crearTransportistaCompleto(req, res) {
  const { id_usuario, ci, telefono } = req.body;

  if (!id_usuario || !ci || !telefono) {
    return res.status(400).json({ error: 'Faltan datos obligatorios' });
  }

  try {
    const pool = await poolPromise;

    // 1. Insertar en la tabla Transportistas
    await pool.request()
      .input('id_usuario', sql.Int, id_usuario)
      .input('ci', sql.NVarChar, ci)
      .input('telefono', sql.NVarChar, telefono)
      .input('estado', sql.NVarChar, 'Disponible') // Por defecto
      .query(`
        INSERT INTO Transportistas (id_usuario, ci, telefono, estado)
        VALUES (@id_usuario, @ci, @telefono, @estado)
      `);

    // 2. Actualizar rol del usuario a 'transportista'
    await pool.request()
      .input('id_usuario', sql.Int, id_usuario)
      .input('rol', sql.NVarChar, 'transportista')
      .query(`
        UPDATE Usuarios SET rol = @rol WHERE id = @id_usuario
      `);

    res.status(201).json({ mensaje: '✅ Transportista creado y rol actualizado correctamente' });
  } catch (err) {
    console.error('❌ Error al crear transportista completo:', err);
    res.status(500).json({ error: 'Error al crear transportista completo' });
  }
}

module.exports = {
  obtenerTodos,
  obtenerPorId,
  crear,
  editar,
  eliminar,
  crearTransportistaCompleto
};



