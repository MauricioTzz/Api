const { sql, poolPromise } = require('../../config/sqlserver');

async function obtenerTodos(req, res) {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query('SELECT * FROM TipoTransporte');
    res.json(result.recordset);
  } catch (err) {
    console.error('Error al obtener tipos de transporte:', err);
    res.status(500).json({ error: 'Error al obtener tipos de transporte' });
  }
}

module.exports = {
  obtenerTodos
};
