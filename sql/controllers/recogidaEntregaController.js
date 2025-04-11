const { sql, poolPromise } = require('../../config/sqlserver');

function parseTimeToDate(timeString) {
  const [hours, minutes, seconds] = timeString.split(':');
  const date = new Date();
  date.setHours(hours, minutes, seconds || 0, 0);
  return date;
}

// Crear nueva recogida y entrega
async function crear(req, res) {
  const {
    fecha_recogida,
    hora_recogida,
    hora_entrega,
    instrucciones_recogida,
    instrucciones_entrega
  } = req.body;

  if (!fecha_recogida || !hora_recogida || !hora_entrega) {
    return res.status(400).json({ error: 'Faltan campos obligatorios' });
  }

  try {
    const pool = await poolPromise;
    const resultado = await pool.request()
      .input('fecha_recogida', sql.Date, fecha_recogida)
      .input('hora_recogida', sql.Time, parseTimeToDate(hora_recogida))
      .input('hora_entrega', sql.Time, parseTimeToDate(hora_entrega))
      .input('instrucciones_recogida', sql.NVarChar, instrucciones_recogida || null)
      .input('instrucciones_entrega', sql.NVarChar, instrucciones_entrega || null)
      .query(`INSERT INTO RecogidaEntrega (fecha_recogida, hora_recogida, hora_entrega, instrucciones_recogida, instrucciones_entrega)
              OUTPUT INSERTED.id
              VALUES (@fecha_recogida, @hora_recogida, @hora_entrega, @instrucciones_recogida, @instrucciones_entrega)`);

    res.status(201).json({ mensaje: 'Registro de recogida/entrega creado', id: resultado.recordset[0].id });
  } catch (err) {
    console.error('❌ Error al crear recogida/entrega:', err);
    res.status(500).json({ error: 'Error en el servidor' });
  }
}

module.exports = {
  crear
};
