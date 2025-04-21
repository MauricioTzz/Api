const { sql, poolPromise } = require('../../config/sqlserver');
const Direccion = require('../../mongo/models/ubicacion');

// 1.- Crear envío completo con particiones (ADMIN)
async function crearEnvioCompletoAdmin(req, res) {
  try {
    const { id_usuario_cliente, ubicacion, particiones } = req.body;

    if (!id_usuario_cliente || !ubicacion || !Array.isArray(particiones) || particiones.length === 0) {
      return res.status(400).json({ error: 'Faltan datos para crear el envío' });
    }

    // 1️⃣ Guardar ubicación MongoDB
    const nuevaUbicacion = new Direccion({ ...ubicacion, id_usuario: id_usuario_cliente });
    await nuevaUbicacion.save();
    const id_ubicacion_mongo = nuevaUbicacion._id.toString();

    const pool = await poolPromise;

    // 2️⃣ Insertar envío principal
    const envioResult = await pool.request()
      .input('id_usuario', sql.Int, id_usuario_cliente)
      .input('id_ubicacion_mongo', sql.NVarChar, id_ubicacion_mongo)
      .input('estado', sql.NVarChar, 'Asignado')
      .query(`
        INSERT INTO Envios (id_usuario, id_ubicacion_mongo, estado)
        OUTPUT INSERTED.id VALUES (@id_usuario, @id_ubicacion_mongo, @estado)
      `);

    const id_envio = envioResult.recordset[0].id;

    // 3️⃣ Procesar cada partición
    for (const bloque of particiones) {
      const { cargas, recogidaEntrega, id_tipo_transporte, id_transportista, id_vehiculo } = bloque;

      if (!cargas || !recogidaEntrega || !id_tipo_transporte || !id_transportista || !id_vehiculo) {
        return res.status(400).json({ error: 'Faltan datos en una de las particiones del envío' });
      }

      // 4️⃣ Insertar RecogidaEntrega
      const r = recogidaEntrega;
      const recogidaResult = await pool.request()
        .input('fecha_recogida', sql.Date, r.fecha_recogida)
        .input('hora_recogida', sql.Time, new Date(`1970-01-01T${r.hora_recogida}`))
        .input('hora_entrega', sql.Time, new Date(`1970-01-01T${r.hora_entrega}`))
        .input('instrucciones_recogida', sql.NVarChar, r.instrucciones_recogida || null)
        .input('instrucciones_entrega', sql.NVarChar, r.instrucciones_entrega || null)
        .query(`
          INSERT INTO RecogidaEntrega (fecha_recogida, hora_recogida, hora_entrega, instrucciones_recogida, instrucciones_entrega)
          OUTPUT INSERTED.id VALUES (@fecha_recogida, @hora_recogida, @hora_entrega, @instrucciones_recogida, @instrucciones_entrega)
        `);

      const id_recogida_entrega = recogidaResult.recordset[0].id;

      // 5️⃣ Verificar disponibilidad
      const validacion = await pool.request()
        .input('t', sql.Int, id_transportista)
        .input('v', sql.Int, id_vehiculo)
        .query(`
          SELECT 
            (SELECT estado FROM Transportistas WHERE id = @t) AS estado_transportista,
            (SELECT estado FROM Vehiculos WHERE id = @v) AS estado_vehiculo
        `);

      const est = validacion.recordset[0];
      if (est.estado_transportista !== 'Disponible' || est.estado_vehiculo !== 'Disponible') {
        return res.status(400).json({ error: `T${id_transportista}, V${id_vehiculo} no disponibles` });
      }

      // 6️⃣ Insertar Asignación
      const asignacionRes = await pool.request()
        .input('id_envio', sql.Int, id_envio)
        .input('id_transportista', sql.Int, id_transportista)
        .input('id_vehiculo', sql.Int, id_vehiculo)
        .input('estado', sql.NVarChar, 'Pendiente')
        .input('id_tipo_transporte', sql.Int, id_tipo_transporte)
        .input('id_recogida_entrega', sql.Int, id_recogida_entrega)
        .query(`
          INSERT INTO AsignacionMultiple (id_envio, id_transportista, id_vehiculo, estado, id_tipo_transporte, id_recogida_entrega)
          OUTPUT INSERTED.id VALUES (@id_envio, @id_transportista, @id_vehiculo, @estado, @id_tipo_transporte, @id_recogida_entrega)
        `);

      const id_asignacion = asignacionRes.recordset[0].id;

      // 7️⃣ Marcar transportista y vehículo como no disponibles
      await pool.request().input('id', sql.Int, id_transportista)
        .query(`UPDATE Transportistas SET estado = 'No Disponible' WHERE id = @id`);
      await pool.request().input('id', sql.Int, id_vehiculo)
        .query(`UPDATE Vehiculos SET estado = 'No Disponible' WHERE id = @id`);

      // 8️⃣ Insertar cargas + asignación
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

        // 🔗 Relacionar carga con asignación (única relación activa)
        await pool.request()
          .input('id_asignacion', sql.Int, id_asignacion)
          .input('id_carga', sql.Int, id_carga)
          .query(`INSERT INTO AsignacionCarga (id_asignacion, id_carga) VALUES (@id_asignacion, @id_carga)`);
      }
    }

    return res.status(201).json({
      mensaje: '✅ Envío creado con múltiples particiones, cargas y asignaciones',
      id_envio
    });

  } catch (err) {
    console.error('❌ Error al crear envío particionado (admin):', err);
    return res.status(500).json({ error: 'Error interno al crear envío (admin)' });
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


   // 3.- Obtener historial completo de envíos de un cliente (con particiones)
async function obtenerHistorialCliente(req, res) {
  const id_usuario = parseInt(req.params.id_usuario);

  if (isNaN(id_usuario)) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  try {
    const pool = await poolPromise;

    // Obtener info del cliente una sola vez
    const clienteRes = await pool.request()
      .input('id_usuario', sql.Int, id_usuario)
      .query(`SELECT nombre, apellido FROM Usuarios WHERE id = @id_usuario`);

    const cliente = clienteRes.recordset[0] || { nombre: '', apellido: '' };

    // Obtener todos los envíos de este cliente
    const enviosRes = await pool.request()
      .input('id_usuario', sql.Int, id_usuario)
      .query(`
        SELECT id, estado, id_ubicacion_mongo, fecha_creacion
        FROM Envios
        WHERE id_usuario = @id_usuario
        ORDER BY fecha_creacion DESC
      `);

    const envios = enviosRes.recordset;
    const historial = [];

    for (const envio of envios) {
      // Obtener ubicación Mongo
      let origen = "—", destino = "—";
      try {
        const ubicacion = await Direccion.findById(envio.id_ubicacion_mongo);
        if (ubicacion) {
          origen = ubicacion.nombreOrigen;
          destino = ubicacion.nombreDestino;
        }
      } catch (err) {}

      // Obtener particiones (asignaciones)
      const asignacionesRes = await pool.request()
        .input('id_envio', sql.Int, envio.id)
        .query(`
          SELECT a.id AS id_asignacion, a.estado, 
                 r.fecha_recogida, r.hora_recogida, r.hora_entrega,
                 tp.nombre AS tipo_transporte
          FROM AsignacionMultiple a
          LEFT JOIN RecogidaEntrega r ON a.id_recogida_entrega = r.id
          LEFT JOIN TipoTransporte tp ON a.id_tipo_transporte = tp.id
          WHERE a.id_envio = @id_envio
        `);

      for (const asignacion of asignacionesRes.recordset) {
        historial.push({
          id_envio: envio.id,
          estado: asignacion.estado,
          fecha_creacion: envio.fecha_creacion,
          tipo_transporte: asignacion.tipo_transporte || "—",
          recogida: {
            fecha: asignacion.fecha_recogida || "—",
            hora: asignacion.hora_recogida || "—"
          },
          entrega: {
            fecha: asignacion.fecha_recogida || "—",
            hora: asignacion.hora_entrega || "—"
          },
          origen,
          destino,
          cliente: {
            nombre: cliente.nombre,
            apellido: cliente.apellido
          }
        });
      }
    }

    res.json(historial);
  } catch (err) {
    console.error('❌ Error al obtener historial del cliente:', err);
    res.status(500).json({ error: 'Error al obtener historial del cliente' });
  }
}


  // 4.- Reutilizar envío anterior
async function reutilizarEnvioAnterior(req, res) {
  const id_envio = parseInt(req.params.id_envio);

  if (isNaN(id_envio)) {
    return res.status(400).json({ error: 'ID de envío inválido' });
  }

  try {
    const pool = await poolPromise;

    // Obtener datos básicos del envío
    const envioRes = await pool.request()
      .input('id', sql.Int, id_envio)
      .query(`SELECT * FROM Envios WHERE id = @id`);

    if (envioRes.recordset.length === 0) {
      return res.status(404).json({ error: 'Envío no encontrado' });
    }

    const envio = envioRes.recordset[0];

    // Obtener ubicación desde MongoDB
    const direccion = await Direccion.findById(envio.id_ubicacion_mongo);

    // Obtener asignaciones del envío
    const asignaciones = await pool.request()
      .input('id_envio', sql.Int, id_envio)
      .query(`
        SELECT a.id AS id_asignacion, a.id_tipo_transporte, a.id_recogida_entrega,
               r.fecha_recogida, r.hora_recogida, r.hora_entrega,
               r.instrucciones_recogida, r.instrucciones_entrega,
               t.nombre AS tipo_transporte_nombre, t.descripcion AS tipo_transporte_descripcion
        FROM AsignacionMultiple a
        INNER JOIN RecogidaEntrega r ON a.id_recogida_entrega = r.id
        INNER JOIN TipoTransporte t ON a.id_tipo_transporte = t.id
        WHERE a.id_envio = @id_envio
      `);

    const particiones = [];

    for (const asignacion of asignaciones.recordset) {
      // Obtener cargas específicas de esta asignación
      const cargasRes = await pool.request()
        .input('id_asignacion', sql.Int, asignacion.id_asignacion)
        .query(`
          SELECT c.*
          FROM AsignacionCarga ac
          INNER JOIN Carga c ON ac.id_carga = c.id
          WHERE ac.id_asignacion = @id_asignacion
        `);

      particiones.push({
        id_tipo_transporte: asignacion.id_tipo_transporte,
        tipoTransporte: {
          nombre: asignacion.tipo_transporte_nombre,
          descripcion: asignacion.tipo_transporte_descripcion
        },
        recogidaEntrega: {
          fecha_recogida: asignacion.fecha_recogida,
          hora_recogida: asignacion.hora_recogida,
          hora_entrega: asignacion.hora_entrega,
          instrucciones_recogida: asignacion.instrucciones_recogida,
          instrucciones_entrega: asignacion.instrucciones_entrega
        },
        cargas: cargasRes.recordset
      });
    }

    // Enviar estructura reutilizable
    return res.json({
      ubicacion: direccion,
      id_usuario_cliente: envio.id_usuario,
      particiones
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
