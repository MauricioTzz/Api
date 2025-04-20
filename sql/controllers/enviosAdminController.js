const { sql, poolPromise } = require('../../config/sqlserver');
const Direccion = require('../../mongo/models/ubicacion');

   // 1.- 
async function crearEnvioCompletoAdmin(req, res) {
  try {
    const {
      id_usuario_cliente,
      ubicacion,
      recogidaEntrega,
      cargas,
      asignaciones,
      id_tipo_transporte
    } = req.body;

    // Validación básica
    if (!id_usuario_cliente || !ubicacion || !recogidaEntrega || !cargas || !asignaciones || !id_tipo_transporte) {
      return res.status(400).json({ error: 'Faltan datos obligatorios para crear el envío' });
    }

    // 1️⃣ Guardar ubicación en MongoDB
    const nuevaUbicacion = new Direccion({
      ...ubicacion,
      id_usuario: id_usuario_cliente
    });
    await nuevaUbicacion.save();
    const id_ubicacion_mongo = nuevaUbicacion._id.toString();

    const pool = await poolPromise;

    // 2️⃣ Insertar RecogidaEntrega (⬅️ MODIFICADO aquí)
    const r = recogidaEntrega;
    const recogidaResult = await pool.request()
      .input('fecha_recogida', sql.Date, r.fecha_recogida)
      .input('hora_recogida', sql.Time, new Date(`1970-01-01T${r.hora_recogida}`))
      .input('hora_entrega', sql.Time, new Date(`1970-01-01T${r.hora_entrega}`))
      .input('instrucciones_recogida', sql.NVarChar, r.instrucciones_recogida || null)
      .input('instrucciones_entrega', sql.NVarChar, r.instrucciones_entrega || null)
      .query(`
        INSERT INTO RecogidaEntrega (fecha_recogida, hora_recogida, hora_entrega, instrucciones_recogida, instrucciones_entrega)
        OUTPUT INSERTED.id
        VALUES (@fecha_recogida, @hora_recogida, @hora_entrega, @instrucciones_recogida, @instrucciones_entrega)
      `);

    const id_recogida_entrega = recogidaResult.recordset[0].id;

    // 3️⃣ Crear Envío principal
    const envioResult = await pool.request()
      .input('id_usuario', sql.Int, id_usuario_cliente)
      .input('id_ubicacion_mongo', sql.NVarChar, id_ubicacion_mongo)
      .input('id_recogida_entrega', sql.Int, id_recogida_entrega)
      .input('id_tipo_transporte', sql.Int, id_tipo_transporte)
      .input('estado', sql.NVarChar, 'Asignado')
      .query(`
        INSERT INTO Envios (id_usuario, id_ubicacion_mongo, id_recogida_entrega, id_tipo_transporte, estado)
        OUTPUT INSERTED.id
        VALUES (@id_usuario, @id_ubicacion_mongo, @id_recogida_entrega, @id_tipo_transporte, @estado)
      `);

    const id_envio = envioResult.recordset[0].id;

    // 4️⃣ Registrar cada carga
    for (const carga of cargas) {
      const cargaRes = await pool.request()
        .input('tipo', sql.NVarChar, carga.tipo)
        .input('variedad', sql.NVarChar, carga.variedad)
        .input('cantidad', sql.Int, carga.cantidad)
        .input('empaquetado', sql.NVarChar, carga.empaquetado)
        .input('peso', sql.Decimal(10, 2), carga.peso)
        .query(`
          INSERT INTO Carga (tipo, variedad, cantidad, empaquetado, peso)
          OUTPUT INSERTED.id VALUES (@tipo, @variedad, @cantidad, @empaquetado, @peso)
        `);

      const id_carga = cargaRes.recordset[0].id;

      await pool.request()
        .input('id_envio', sql.Int, id_envio)
        .input('id_carga', sql.Int, id_carga)
        .query(`
          INSERT INTO EnvioCarga (id_envio, id_carga)
          VALUES (@id_envio, @id_carga)
        `);
    }

    // 5️⃣ Registrar asignaciones múltiples
    for (const asignacion of asignaciones) {
      const t = asignacion.id_transportista;
      const v = asignacion.id_vehiculo;

      // Validar disponibilidad
      const validacion = await pool.request()
        .input('t', sql.Int, t)
        .input('v', sql.Int, v)
        .query(`
          SELECT 
            (SELECT estado FROM Transportistas WHERE id = @t) AS estado_transportista,
            (SELECT estado FROM Vehiculos WHERE id = @v) AS estado_vehiculo
        `);

      const est = validacion.recordset[0];
      if (est.estado_transportista !== 'Disponible' || est.estado_vehiculo !== 'Disponible') {
        return res.status(400).json({
          error: `Transportista o vehículo no disponibles para asignación: T${t}, V${v}`
        });
      }

      // Registrar asignación
      await pool.request()
        .input('id_envio', sql.Int, id_envio)
        .input('id_transportista', sql.Int, t)
        .input('id_vehiculo', sql.Int, v)
        .input('estado', sql.NVarChar, 'Pendiente')
        .query(`
          INSERT INTO AsignacionMultiple (id_envio, id_transportista, id_vehiculo, estado)
          VALUES (@id_envio, @id_transportista, @id_vehiculo, @estado)
        `);

      // Cambiar estado a No Disponible
      await pool.request()
        .input('id', sql.Int, t)
        .query(`UPDATE Transportistas SET estado = 'No Disponible' WHERE id = @id`);

      await pool.request()
        .input('id', sql.Int, v)
        .query(`UPDATE Vehiculos SET estado = 'No Disponible' WHERE id = @id`);
    }

    return res.status(201).json({
      mensaje: '✅ Envío creado correctamente con múltiples cargas y asignaciones',
      id_envio
    });

  } catch (err) {
    console.error('❌ Error al crear envío admin:', err);
    return res.status(500).json({ error: 'Error al crear el envío (admin)' });
  }
}

    // 2.- 
async function buscarCliente(req, res) {
    const query = req.query.query;
  
    if (!query) {
      return res.status(400).json({ error: 'Debe proporcionar un término de búsqueda' });
    }
  
    try {
      const pool = await poolPromise;
      const resultado = await pool.request()
        .input('query', sql.NVarChar, `%${query}%`)
        .query(`
          SELECT id, nombre, apellido, correo
          FROM Usuarios
          WHERE rol = 'cliente' AND (
            nombre LIKE @query OR
            apellido LIKE @query OR
            correo LIKE @query
          )
        `);
  
      return res.json(resultado.recordset);
    } catch (err) {
      console.error('❌ Error al buscar cliente:', err);
      return res.status(500).json({ error: 'Error interno al buscar cliente' });
    }
  }


    // 3.- 
  async function obtenerHistorialCliente(req, res) {
    const id_usuario = parseInt(req.params.id_usuario);
  
    if (isNaN(id_usuario)) {
      return res.status(400).json({ error: 'ID inválido' });
    }
  
    try {
      const pool = await poolPromise;
      const resultado = await pool.request()
        .input('id_usuario', sql.Int, id_usuario)
        .query(`
          SELECT 
            e.id AS id_envio,
            e.estado,
            e.fecha_creacion,
            r.fecha_recogida, r.hora_recogida, r.hora_entrega,
            tp.nombre AS tipo_transporte
          FROM Envios e
          LEFT JOIN RecogidaEntrega r ON e.id_recogida_entrega = r.id
          LEFT JOIN TipoTransporte tp ON e.id_tipo_transporte = tp.id
          WHERE e.id_usuario = @id_usuario
          ORDER BY e.fecha_creacion DESC
        `);
  
      res.json(resultado.recordset);
    } catch (err) {
      console.error('❌ Error al obtener historial del cliente:', err);
      res.status(500).json({ error: 'Error al obtener historial del cliente' });
    }
  }

         // 4.- 
  async function reutilizarEnvioAnterior(req, res) {
    const id_envio = parseInt(req.params.id_envio);
  
    if (isNaN(id_envio)) {
      return res.status(400).json({ error: 'ID de envío inválido' });
    }
  
    try {
      const pool = await poolPromise;
  
      // Obtener datos básicos del envío
      const envio = await pool.request()
        .input('id', sql.Int, id_envio)
        .query(`
          SELECT *
          FROM Envios
          WHERE id = @id
        `);
  
      if (envio.recordset.length === 0) {
        return res.status(404).json({ error: 'Envío no encontrado' });
      }
  
      const envioData = envio.recordset[0];
  
      // Obtener recogida/entrega
      const r = await pool.request()
        .input('id', sql.Int, envioData.id_recogida_entrega)
        .query(`SELECT * FROM RecogidaEntrega WHERE id = @id`);
      
      // Obtener tipo de transporte
      const t = await pool.request()
        .input('id', sql.Int, envioData.id_tipo_transporte)
        .query(`SELECT * FROM TipoTransporte WHERE id = @id`);
  
      // Obtener cargas (pueden ser múltiples)
      const cargasRes = await pool.request()
        .input('id_envio', sql.Int, id_envio)
        .query(`
          SELECT c.*
          FROM EnvioCarga ec
          INNER JOIN Carga c ON ec.id_carga = c.id
          WHERE ec.id_envio = @id_envio
        `);
  
      // Obtener ubicación desde Mongo
      const direccion = await Direccion.findById(envioData.id_ubicacion_mongo);
  
      res.json({
        ubicacion: direccion,
        recogidaEntrega: r.recordset[0],
        tipoTransporte: t.recordset[0],
        cargas: cargasRes.recordset,
        id_usuario_cliente: envioData.id_usuario
      });
  
    } catch (err) {
      console.error('❌ Error al reutilizar envío:', err);
      res.status(500).json({ error: 'Error al obtener datos del envío' });
    }
  }
  


module.exports = {
  crearEnvioCompletoAdmin,
  buscarCliente,
  obtenerHistorialCliente,
  reutilizarEnvioAnterior
};
