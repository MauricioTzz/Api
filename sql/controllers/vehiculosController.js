// sql/controllers/vehiculosController.js
const { sql, poolPromise } = require('../../config/sqlserver');

// Obtener todos los vehículos
async function obtenerTodos(req, res) {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query('SELECT * FROM Vehiculos');
    res.json(result.recordset);
  } catch (err) {
    console.error('Error al obtener vehículos:', err);
    res.status(500).json({ error: 'Error al obtener vehículos' });
  }
}

// Obtener vehículo por ID
async function obtenerPorId(req, res) {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('id', sql.Int, req.params.id)
      .query('SELECT * FROM Vehiculos WHERE id = @id');

    if (result.recordset.length === 0) {
      return res.status(404).json({ error: 'Vehículo no encontrado' });
    }

    res.json(result.recordset[0]);
  } catch (err) {
    console.error('Error al obtener vehículo:', err);
    res.status(500).json({ error: 'Error al obtener vehículo' });
  }
}

// Crear vehículo
async function crear(req, res) {
  const { tipo, placa, capacidad, estado } = req.body;

  if (!tipo || !placa || !capacidad || !estado) {
    return res.status(400).json({ error: 'Faltan datos obligatorios' });
  }

  try {
    const pool = await poolPromise;
    await pool.request()
      .input('tipo', sql.NVarChar, tipo)
      .input('placa', sql.NVarChar, placa)
      .input('capacidad', sql.Decimal(10, 2), capacidad)
      .input('estado', sql.NVarChar, estado)
      .query(`INSERT INTO Vehiculos (tipo, placa, capacidad, estado)
              VALUES (@tipo, @placa, @capacidad, @estado)`);

    res.status(201).json({ mensaje: 'Vehículo creado correctamente' });
  } catch (err) {
    console.error('Error al crear vehículo:', err);
    res.status(500).json({ error: 'Error al crear vehículo' });
  }
}

// Editar vehículo
async function editar(req, res) {
  const { tipo, placa, capacidad, estado } = req.body;

  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('id', sql.Int, req.params.id)
      .input('tipo', sql.NVarChar, tipo)
      .input('placa', sql.NVarChar, placa)
      .input('capacidad', sql.Decimal(10, 2), capacidad)
      .input('estado', sql.NVarChar, estado)
      .query(`UPDATE Vehiculos SET tipo = @tipo, placa = @placa, capacidad = @capacidad, estado = @estado
              WHERE id = @id`);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Vehículo no encontrado' });
    }

    res.json({ mensaje: 'Vehículo actualizado correctamente' });
  } catch (err) {
    console.error('Error al editar vehículo:', err);
    res.status(500).json({ error: 'Error al editar vehículo' });
  }
}

// Eliminar vehículo
async function eliminar(req, res) {
  try {
    const pool = await poolPromise;
    const result = await pool.request()
      .input('id', sql.Int, req.params.id)
      .query('DELETE FROM Vehiculos WHERE id = @id');

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Vehículo no encontrado' });
    }

    res.json({ mensaje: 'Vehículo eliminado correctamente' });
  } catch (err) {
    console.error('Error al eliminar vehículo:', err);
    res.status(500).json({ error: 'Error al eliminar vehículo' });
  }
}

module.exports = {
  obtenerTodos,
  obtenerPorId,
  crear,
  editar,
  eliminar
};
