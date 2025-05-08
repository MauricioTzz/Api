const { sql, poolPromise } = require('../../config/sqlserver');
const Direccion = require('../../mongo/models/ubicacion');
const FirmaEnvio = require('../../mongo/models/firmaEnvio');

// 1.- Crear envío completo con múltiples particiones y cargas (CLIENTE o ADMIN)
async function crearEnvioCompleto(req, res) {
  try {
    const { id_ubicacion_mongo, particiones } = req.body;
    const id_usuario_cliente = req.usuario.id;

    if (!id_ubicacion_mongo || !Array.isArray(particiones) || particiones.length === 0) {
      return res.status(400).json({ error: 'Faltan datos para crear el envío (ubicación o particiones)' });
    }

    const pool = await poolPromise;

    // 1️⃣ Insertar envío principal
    const envioResult = await pool.request()
      .input('id_usuario', sql.Int, id_usuario_cliente)
      .input('id_ubicacion_mongo', sql.NVarChar, id_ubicacion_mongo)
      .input('estado', sql.NVarChar, 'Pendiente') // Siempre pendiente
      .query(`
        INSERT INTO Envios (id_usuario, id_ubicacion_mongo, estado)
        OUTPUT INSERTED.id
        VALUES (@id_usuario, @id_ubicacion_mongo, @estado)
      `);

    const id_envio = envioResult.recordset[0].id;

    // 2️⃣ Procesar particiones
    for (const particion of particiones) {
      const { cargas, recogidaEntrega, id_tipo_transporte } = particion;

      if (!cargas || !Array.isArray(cargas) || cargas.length === 0 || !recogidaEntrega || !id_tipo_transporte) {
        return res.status(400).json({ error: 'Cada partición debe incluir cargas, recogidaEntrega y tipo de transporte' });
      }

      // 3️⃣ Insertar RecogidaEntrega
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

      // 4️⃣ Insertar AsignacionMultiple SIN transportista ni vehículo
      const asignacionRes = await pool.request()
        .input('id_envio', sql.Int, id_envio)
        .input('id_tipo_transporte', sql.Int, id_tipo_transporte)
        .input('estado', sql.NVarChar, 'Pendiente')
        .input('id_recogida_entrega', sql.Int, id_recogida_entrega)
        .query(`
          INSERT INTO AsignacionMultiple (id_envio, id_tipo_transporte, estado, id_recogida_entrega)
          OUTPUT INSERTED.id
          VALUES (@id_envio, @id_tipo_transporte, @estado, @id_recogida_entrega)
        `);

      const id_asignacion = asignacionRes.recordset[0].id;

      // 5️⃣ Insertar todas las cargas de esta partición
      for (const carga of cargas) {
        const cargaRes = await pool.request()
          .input('tipo', sql.NVarChar, carga.tipo)
          .input('variedad', sql.NVarChar, carga.variedad)
          .input('cantidad', sql.Int, carga.cantidad)
          .input('empaquetado', sql.NVarChar, carga.empaquetado)
          .input('peso', sql.Decimal(10, 2), carga.peso)
          .query(`
            INSERT INTO Carga (tipo, variedad, cantidad, empaquetado, peso)
            OUTPUT INSERTED.id
            VALUES (@tipo, @variedad, @cantidad, @empaquetado, @peso)
          `);

        const id_carga = cargaRes.recordset[0].id;

        // 🔗 Relacionar carga con asignación
        await pool.request()
          .input('id_asignacion', sql.Int, id_asignacion)
          .input('id_carga', sql.Int, id_carga)
          .query(`
            INSERT INTO AsignacionCarga (id_asignacion, id_carga)
            VALUES (@id_asignacion, @id_carga)
          `);
      }
    }

    return res.status(201).json({
      mensaje: '✅ Envío creado exitosamente para el cliente',
      id_envio
    });

  } catch (err) {
    console.error('❌ Error al crear envío completo cliente:', err);
    return res.status(500).json({ error: 'Error interno al crear envío (cliente)' });
  }
}


// 2.- Obtener todos los envíos
async function obtenerTodos(req, res) {
  const usuario = req.usuario;

  try {
    const pool = await poolPromise;
    const request = pool.request();

    let query = `
      SELECT 
        e.*, 
        u.nombre AS nombre_usuario, 
        u.apellido AS apellido_usuario, 
        u.rol AS rol_usuario
      FROM Envios e
      LEFT JOIN Usuarios u ON e.id_usuario = u.id
    `;

    if (usuario.rol !== 'admin') {
      query += ' WHERE e.id_usuario = @id_usuario';
      request.input('id_usuario', sql.Int, usuario.id);
    }

    const result = await request.query(query);
    const enviosBase = result.recordset;

    const enviosCompletos = await Promise.all(enviosBase.map(async envio => {
      try {
        // Obtener asignaciones del envío (cada una representa una partición)
        const asignaciones = await pool.request()
          .input('id_envio', sql.Int, envio.id)
          .query(`
            SELECT am.*, 
                   t.ci AS ci_transportista, 
                   t.telefono AS telefono_transportista, 
                   v.placa, 
                   v.tipo AS tipo_vehiculo,
                   u.nombre AS nombre_transportista,
                   u.apellido AS apellido_transportista
            FROM AsignacionMultiple am
            LEFT JOIN Transportistas t ON am.id_transportista = t.id
            LEFT JOIN Usuarios u ON t.id_usuario = u.id
            LEFT JOIN Vehiculos v ON am.id_vehiculo = v.id
            WHERE am.id_envio = @id_envio
          `);

          const particiones = await Promise.all(asignaciones.recordset.map(async asignacion => {
            // ✅ Obtener cargas de esta asignación
            const cargas = await pool.request()
              .input('id_asignacion', sql.Int, asignacion.id)
              .query(`
                SELECT c.*
                FROM AsignacionCarga ac
                INNER JOIN Carga c ON ac.id_carga = c.id
                WHERE ac.id_asignacion = @id_asignacion
              `);
          
            // ✅ Obtener recogidaEntrega de esta asignación
            const recogida = await pool.request()
              .input('id', sql.Int, asignacion.id_recogida_entrega)
              .query(`SELECT * FROM RecogidaEntrega WHERE id = @id`);
          
            // ✅ Obtener tipo de transporte
            const transporte = await pool.request()
              .input('id', sql.Int, asignacion.id_tipo_transporte)
              .query(`SELECT * FROM TipoTransporte WHERE id = @id`);
          
            return {
              id_asignacion: asignacion.id,
              estado: asignacion.estado,
              fecha_asignacion: asignacion.fecha_asignacion,
              fecha_inicio: asignacion.fecha_inicio,
              fecha_fin: asignacion.fecha_fin,
              transportista: {
                nombre: asignacion.nombre_transportista,
                apellido: asignacion.apellido_transportista,
                ci: asignacion.ci_transportista,
                telefono: asignacion.telefono_transportista
              },
              vehiculo: {
                placa: asignacion.placa,
                tipo: asignacion.tipo_vehiculo
              },
              cargas: cargas.recordset,
              recogidaEntrega: recogida.recordset[0],
              tipoTransporte: transporte.recordset[0]
            };
          }));

        envio.particiones = particiones;

        // UBICACIÓN (MongoDB)
        try {
          const ubicacion = await Direccion.findById(envio.id_ubicacion_mongo);
          if (ubicacion) {
            envio.nombre_origen = ubicacion.nombreOrigen || "—";
            envio.nombre_destino = ubicacion.nombreDestino || "—";
          } else {
            envio.nombre_origen = "—";
            envio.nombre_destino = "—";
          }
        } catch (err) {
          envio.nombre_origen = "—";
          envio.nombre_destino = "—";
        }

      } catch (errInterno) {
        console.warn("⚠️ Error procesando envío ID:", envio.id, errInterno.message);
      }

      return envio;
    }));

    res.json(enviosCompletos);

  } catch (err) {
    console.error('❌ Error al obtener envíos:', err);
    res.status(500).json({ error: 'Error al obtener envíos' });
  }
}


// 3.- Obtener envío por ID
async function obtenerPorId(req, res) {
  const envioId = parseInt(req.params.id);
  if (isNaN(envioId)) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  try {
    const pool = await poolPromise;

    // Obtener datos generales del envío
    const resultado = await pool.request()
      .input('id', sql.Int, envioId)
      .query(`
        SELECT e.*, 
               u.nombre AS nombre_usuario, 
               u.apellido AS apellido_usuario
        FROM Envios e
        LEFT JOIN Usuarios u ON e.id_usuario = u.id
        WHERE e.id = @id
      `);

    if (resultado.recordset.length === 0) {
      return res.status(404).json({ error: 'Envío no encontrado' });
    }

    const envio = resultado.recordset[0];

    // Validar permisos
    if (req.usuario.rol !== 'admin' && envio.id_usuario !== req.usuario.id) {
      return res.status(403).json({ error: 'No tienes permiso para ver este envío' });
    }

    // UBICACIÓN MongoDB
    try {
      const ubicacion = await Direccion.findById(envio.id_ubicacion_mongo).lean();
      if (ubicacion) {
        envio.coordenadas_origen = ubicacion.coordenadasOrigen;
        envio.coordenadas_destino = ubicacion.coordenadasDestino;
        envio.nombre_origen = ubicacion.nombreOrigen;
        envio.nombre_destino = ubicacion.nombreDestino;
        envio.rutaGeoJSON = ubicacion.rutaGeoJSON;
      }
    } catch (errMongo) {
      console.warn("⚠️ Error obteniendo ubicación:", errMongo.message);
    }

    // Obtener asignaciones (particiones)
    const asignacionesRes = await pool.request()
      .input('id_envio', sql.Int, envioId)
      .query(`
        SELECT am.*, 
               u.nombre AS nombre_transportista, 
               u.apellido AS apellido_transportista,
               t.ci AS ci_transportista,
               t.telefono AS telefono_transportista,
               v.placa, v.tipo AS tipo_vehiculo,
               tp.nombre AS nombre_tipo_transporte,
               tp.descripcion AS descripcion_tipo_transporte,
               re.fecha_recogida, re.hora_recogida, re.hora_entrega,
               re.instrucciones_recogida, re.instrucciones_entrega
        FROM AsignacionMultiple am
        LEFT JOIN Transportistas t ON am.id_transportista = t.id
        LEFT JOIN Usuarios u ON t.id_usuario = u.id
        LEFT JOIN Vehiculos v ON am.id_vehiculo = v.id
        LEFT JOIN TipoTransporte tp ON am.id_tipo_transporte = tp.id
        LEFT JOIN RecogidaEntrega re ON am.id_recogida_entrega = re.id
        WHERE am.id_envio = @id_envio
      `);

    const asignaciones = await Promise.all(asignacionesRes.recordset.map(async asignacion => {
      const cargas = await pool.request()
        .input('id_asignacion', sql.Int, asignacion.id)
        .query(`
          SELECT c.*
          FROM AsignacionCarga ac
          INNER JOIN Carga c ON ac.id_carga = c.id
          WHERE ac.id_asignacion = @id_asignacion
        `);

      return {
        id_asignacion: asignacion.id,
        estado: asignacion.estado,
        fecha_asignacion: asignacion.fecha_asignacion,
        fecha_inicio: asignacion.fecha_inicio,
        fecha_fin: asignacion.fecha_fin,
        transportista: {
          nombre: asignacion.nombre_transportista,
          apellido: asignacion.apellido_transportista,
          telefono: asignacion.telefono_transportista,
          ci: asignacion.ci_transportista
        },
        vehiculo: {
          placa: asignacion.placa,
          tipo: asignacion.tipo_vehiculo
        },
        tipoTransporte: {
          nombre: asignacion.nombre_tipo_transporte,
          descripcion: asignacion.descripcion_tipo_transporte
        },
        recogidaEntrega: {
          fecha_recogida: asignacion.fecha_recogida,
          hora_recogida: asignacion.hora_recogida,
          hora_entrega: asignacion.hora_entrega,
          instrucciones_recogida: asignacion.instrucciones_recogida,
          instrucciones_entrega: asignacion.instrucciones_entrega
        },
        cargas: cargas.recordset
      };
    }));

    envio.particiones = asignaciones;

    const total = asignaciones.length;
    const activos = asignaciones.filter(a => a.estado === 'En curso').length;
    envio.estado_resumen = `En curso (${activos} de ${total} camiones activos)`;

    return res.json(envio);

  } catch (err) {
    console.error('❌ Error al obtener envío por ID:', err);
    return res.status(500).json({ error: 'Error al obtener el envío' });
  }
}



// 4.- Asignar transportista y vehículo (adaptado con partición)
async function asignarTransportistaYVehiculo(req, res) {
  const id_envio = parseInt(req.params.id);
  const { id_transportista, id_vehiculo, carga, recogidaEntrega, id_tipo_transporte } = req.body;

  if (!id_transportista || !id_vehiculo || !carga || !recogidaEntrega || !id_tipo_transporte) {
    return res.status(400).json({ error: 'Faltan datos para la asignación completa (incluyendo tipo de transporte)' });
  }

  try {
    const pool = await poolPromise;

    // Verificar disponibilidad
    const disponibilidad = await pool.request()
      .input('id_transportista', sql.Int, id_transportista)
      .input('id_vehiculo', sql.Int, id_vehiculo)
      .query(`
        SELECT 
          (SELECT estado FROM Transportistas WHERE id = @id_transportista) AS estado_transportista,
          (SELECT estado FROM Vehiculos WHERE id = @id_vehiculo) AS estado_vehiculo
      `);

    const { estado_transportista, estado_vehiculo } = disponibilidad.recordset[0];

    if (estado_transportista !== 'Disponible' || estado_vehiculo !== 'Disponible') {
      return res.status(400).json({ error: '❌ Transportista o vehículo no disponibles' });
    }

    // Verificar existencia del envío
    const envioExiste = await pool.request()
      .input('id_envio', sql.Int, id_envio)
      .query('SELECT id FROM Envios WHERE id = @id_envio');

    if (envioExiste.recordset.length === 0) {
      return res.status(404).json({ error: 'Envío no encontrado' });
    }

    // Insertar carga
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

    // Insertar RecogidaEntrega
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

    // Insertar asignación múltiple (con recogida y tipo de transporte)
    const asignacionResult = await pool.request()
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

    const id_asignacion = asignacionResult.recordset[0].id;

    // Relacionar carga al envío y asignación
    await pool.request()
      .input('id_envio', sql.Int, id_envio)
      .input('id_carga', sql.Int, id_carga)
      .query(`INSERT INTO EnvioCarga (id_envio, id_carga) VALUES (@id_envio, @id_carga)`);

    await pool.request()
      .input('id_asignacion', sql.Int, id_asignacion)
      .input('id_carga', sql.Int, id_carga)
      .query(`INSERT INTO AsignacionCarga (id_asignacion, id_carga) VALUES (@id_asignacion, @id_carga)`);

    // Actualizar estados
    await pool.request().input('id', sql.Int, id_transportista)
      .query(`UPDATE Transportistas SET estado = 'No Disponible' WHERE id = @id`);

    await pool.request().input('id', sql.Int, id_vehiculo)
      .query(`UPDATE Vehiculos SET estado = 'No Disponible' WHERE id = @id`);

    res.json({ mensaje: '✅ Asignación registrada correctamente con carga y detalles completos' });

  } catch (err) {
    console.error('❌ Error al asignar:', err);
    res.status(500).json({ error: 'Error al asignar transporte' });
  }
}



// 4.1.- Asignar transportista y vehículo a una partición ya existente (para envíos creados por cliente)
async function asignarTransportistaYVehiculoAParticion(req, res) {
  const id_asignacion = parseInt(req.params.id_asignacion); // capturamos el ID de la partición
  const { id_transportista, id_vehiculo } = req.body; // recibimos transportista y vehículo

  if (!id_transportista || !id_vehiculo) {
    return res.status(400).json({ error: 'Faltan datos para la asignación (transportista y vehículo)' });
  }

  try {
    const pool = await poolPromise;

    // Verificar disponibilidad del transportista y vehículo
    const disponibilidad = await pool.request()
      .input('id_transportista', sql.Int, id_transportista)
      .input('id_vehiculo', sql.Int, id_vehiculo)
      .query(`
        SELECT 
          (SELECT estado FROM Transportistas WHERE id = @id_transportista) AS estado_transportista,
          (SELECT estado FROM Vehiculos WHERE id = @id_vehiculo) AS estado_vehiculo
      `);

    const { estado_transportista, estado_vehiculo } = disponibilidad.recordset[0];

    if (estado_transportista !== 'Disponible' || estado_vehiculo !== 'Disponible') {
      return res.status(400).json({ error: '❌ Transportista o vehículo no disponibles' });
    }

    // Verificar existencia de la partición y obtener id_envio
    const particionExiste = await pool.request()
      .input('id_asignacion', sql.Int, id_asignacion)
      .query('SELECT id, id_envio FROM AsignacionMultiple WHERE id = @id_asignacion');

    if (particionExiste.recordset.length === 0) {
      return res.status(404).json({ error: 'Partición (Asignación) no encontrada' });
    }

    const { id_envio } = particionExiste.recordset[0];

    // Actualizar la partición existente con transportista y vehículo
    await pool.request()
      .input('id_asignacion', sql.Int, id_asignacion)
      .input('id_transportista', sql.Int, id_transportista)
      .input('id_vehiculo', sql.Int, id_vehiculo)
      .query(`
        UPDATE AsignacionMultiple
        SET id_transportista = @id_transportista,
            id_vehiculo = @id_vehiculo,
            estado = 'Pendiente'
        WHERE id = @id_asignacion
      `);

    // Marcar transportista y vehículo como No Disponible
    await pool.request()
      .input('id', sql.Int, id_transportista)
      .query(`UPDATE Transportistas SET estado = 'No Disponible' WHERE id = @id`);

    await pool.request()
      .input('id', sql.Int, id_vehiculo)
      .query(`UPDATE Vehiculos SET estado = 'No Disponible' WHERE id = @id`);

    // ✅ Actualizar el estado global del envío
    await actualizarEstadoGlobalEnvio(id_envio, pool);

    res.json({ mensaje: '✅ Transportista y vehículo asignados correctamente a la partición' });

  } catch (err) {
    console.error('❌ Error al asignar a partición:', err);
    res.status(500).json({ error: 'Error interno al asignar a partición' });
  }
}



// 5.- Obtener solo mis envíos ya sea de Cliente o Admin
async function obtenerMisEnvios(req, res) {
  const user = req.usuario || req.user;

  if (!user || typeof user.id !== 'number') {
    return res.status(401).json({ error: 'No se pudo identificar al usuario desde el token' });
  }

  const userId = user.id;
  console.log('📌 ID del usuario autenticado (mis-envios):', userId);

  try {
    const pool = await poolPromise;

    // 1️⃣ Obtener envíos del usuario
    const resultado = await pool.request()
      .input('id_usuario', sql.Int, userId)
      .query(`
        SELECT e.*, 
               u.nombre AS nombre_usuario, 
               u.apellido AS apellido_usuario, 
               u.rol AS rol_usuario
        FROM Envios e
        LEFT JOIN Usuarios u ON e.id_usuario = u.id
        WHERE e.id_usuario = @id_usuario
      `);

    const envios = resultado.recordset;

    // 2️⃣ Enriquecer cada envío con particiones (asignaciones)
    const enviosCompletos = await Promise.all(envios.map(async envio => {
      try {
        // UBICACIÓN desde MongoDB
        try {
          const ubicacion = await Direccion.findById(envio.id_ubicacion_mongo);
          if (ubicacion) {
            envio.nombre_origen = ubicacion.nombreOrigen || "—";
            envio.nombre_destino = ubicacion.nombreDestino || "—";
          } else {
            envio.nombre_origen = "—";
            envio.nombre_destino = "—";
          }
        } catch (err) {
          envio.nombre_origen = "—";
          envio.nombre_destino = "—";
        }

        // Obtener asignaciones
        const asignacionesRes = await pool.request()
          .input('id_envio', sql.Int, envio.id)
          .query(`
            SELECT am.*, 
                   t.ci AS ci_transportista,
                   t.telefono AS telefono_transportista,
                   u.nombre AS nombre_transportista,
                   u.apellido AS apellido_transportista,
                   v.placa, v.tipo AS tipo_vehiculo,
                   re.fecha_recogida, re.hora_recogida, re.hora_entrega,
                   re.instrucciones_recogida, re.instrucciones_entrega,
                   tp.nombre AS tipo_transporte, tp.descripcion AS descripcion_transporte
            FROM AsignacionMultiple am
            LEFT JOIN Transportistas t ON am.id_transportista = t.id
            LEFT JOIN Usuarios u ON t.id_usuario = u.id
            LEFT JOIN Vehiculos v ON am.id_vehiculo = v.id
            LEFT JOIN RecogidaEntrega re ON re.id = am.id_recogida_entrega
            LEFT JOIN TipoTransporte tp ON tp.id = am.id_tipo_transporte
            WHERE am.id_envio = @id_envio
          `);

        const particiones = await Promise.all(asignacionesRes.recordset.map(async asignacion => {
          // Obtener cargas específicas de la asignación
          const cargasRes = await pool.request()
            .input('id_asignacion', sql.Int, asignacion.id)
            .query(`
              SELECT c.*
              FROM AsignacionCarga ac
              INNER JOIN Carga c ON ac.id_carga = c.id
              WHERE ac.id_asignacion = @id_asignacion
            `);

          return {
            id_asignacion: asignacion.id,
            estado: asignacion.estado,
            fecha_asignacion: asignacion.fecha_asignacion,
            fecha_inicio: asignacion.fecha_inicio,
            fecha_fin: asignacion.fecha_fin,
            transportista: {
              nombre: asignacion.nombre_transportista,
              apellido: asignacion.apellido_transportista,
              ci: asignacion.ci_transportista,
              telefono: asignacion.telefono_transportista
            },
            vehiculo: {
              placa: asignacion.placa,
              tipo: asignacion.tipo_vehiculo
            },
            recogidaEntrega: {
              fecha_recogida: asignacion.fecha_recogida,
              hora_recogida: asignacion.hora_recogida,
              hora_entrega: asignacion.hora_entrega,
              instrucciones_recogida: asignacion.instrucciones_recogida,
              instrucciones_entrega: asignacion.instrucciones_entrega
            },
            tipoTransporte: {
              nombre: asignacion.tipo_transporte,
              descripcion: asignacion.descripcion_transporte
            },
            cargas: cargasRes.recordset
          };
        }));

        envio.particiones = particiones;
      } catch (interno) {
        console.warn("⚠️ Error enriqueciendo envío ID:", envio.id, interno.message);
      }

      return envio;
    }));

    return res.json(enviosCompletos);

  } catch (err) {
    console.error('❌ Error al obtener tus envíos:', err);
    res.status(500).json({ error: 'Error al obtener tus envíos' });
  }
}


// 6.- Iniciar viaje (solo transportista asignado)
async function iniciarViaje(req, res) {
  const id_asignacion = parseInt(req.params.id);
  const userId = req.usuario.id;
  const rol = req.usuario.rol;

  if (rol !== 'transportista') {
    return res.status(403).json({ error: 'Solo los transportistas pueden iniciar el viaje' });
  }

  try {
    const pool = await poolPromise;

    // 1️⃣ Obtener ID del transportista autenticado
    const transportistaRes = await pool.request()
      .input('id_usuario', sql.Int, userId)
      .query('SELECT id FROM Transportistas WHERE id_usuario = @id_usuario');

    if (transportistaRes.recordset.length === 0) {
      return res.status(403).json({ error: 'No se encontró al transportista' });
    }

    const id_transportista = transportistaRes.recordset[0].id;

    // 2️⃣ Verificar asignación válida
    const asignacionRes = await pool.request()
      .input('id_asignacion', sql.Int, id_asignacion)
      .input('id_transportista', sql.Int, id_transportista)
      .query(`
        SELECT * FROM AsignacionMultiple 
        WHERE id = @id_asignacion AND id_transportista = @id_transportista AND estado = 'Pendiente'
      `);

    if (asignacionRes.recordset.length === 0) {
      return res.status(403).json({ error: 'No tienes acceso o la asignación no está disponible para iniciar' });
    }

    const asignacion = asignacionRes.recordset[0];

    // 3️⃣ Verificar checklist por asignación
    const checklistRes = await pool.request()
      .input('id_asignacion', sql.Int, id_asignacion)
      .query(`
        SELECT id FROM ChecklistCondicionesTransporte WHERE id_asignacion = @id_asignacion
      `);

    if (checklistRes.recordset.length === 0) {
      return res.status(400).json({ error: 'Debes completar el checklist antes de iniciar el viaje' });
    }

    // 4️⃣ Actualizar asignación
    await pool.request()
      .input('estado', sql.NVarChar, 'En curso')
      .input('fecha_inicio', sql.DateTime, new Date())
      .input('id', sql.Int, id_asignacion)
      .query(`
        UPDATE AsignacionMultiple 
        SET estado = @estado, fecha_inicio = @fecha_inicio 
        WHERE id = @id
      `);

    // 5️⃣ Actualizar estado de recursos
    await pool.request()
      .input('id', sql.Int, asignacion.id_transportista)
      .query(`UPDATE Transportistas SET estado = 'En ruta' WHERE id = @id`);

    await pool.request()
      .input('id', sql.Int, asignacion.id_vehiculo)
      .query(`UPDATE Vehiculos SET estado = 'En ruta' WHERE id = @id`);

    // 6️⃣ ACTUALIZAR ESTADO GLOBAL DEL ENVÍO
    const asignaciones = await pool.request()
      .input('id_envio', sql.Int, asignacion.id_envio)
      .query(`SELECT estado FROM AsignacionMultiple WHERE id_envio = @id_envio`);

    const estados = asignaciones.recordset.map(a => a.estado);
    let nuevoEstado = 'Asignado';

    if (estados.length === 0) {
      nuevoEstado = 'Pendiente';
    } else if (estados.every(e => e === 'Entregado')) {
      nuevoEstado = 'Entregado';
    } else if (estados.every(e => e === 'Pendiente')) {
      nuevoEstado = 'Asignado';
    } else if (estados.some(e => e === 'Entregado') && estados.some(e => e !== 'Entregado')) {
      nuevoEstado = 'Parcialmente entregado';
    } else if (estados.some(e => e === 'En curso')) {
      nuevoEstado = 'En curso';
    }

    await pool.request()
      .input('id_envio', sql.Int, asignacion.id_envio)
      .input('estado', sql.NVarChar, nuevoEstado)
      .query('UPDATE Envios SET estado = @estado WHERE id = @id_envio');

    res.json({ mensaje: '✅ Viaje iniciado correctamente para esta asignación' });

  } catch (err) {
    console.error('❌ Error al iniciar viaje:', err);
    res.status(500).json({ error: 'Error al iniciar el viaje' });
  }
}




// 7.- Obtener envíos asignados al transportista autenticado
async function obtenerEnviosAsignadosTransportista(req, res) {
  const id_usuario = req.usuario.id;

  try {
    const pool = await poolPromise;

    // 1️⃣ Obtener ID del transportista autenticado
    const resultTransportista = await pool.request()
      .input('id_usuario', sql.Int, id_usuario)
      .query('SELECT id FROM Transportistas WHERE id_usuario = @id_usuario');

    if (resultTransportista.recordset.length === 0) {
      return res.status(404).json({ error: 'No eres un transportista válido' });
    }

    const id_transportista = resultTransportista.recordset[0].id;

    // 2️⃣ Obtener asignaciones de este transportista
    const result = await pool.request()
      .input('id_transportista', sql.Int, id_transportista)
      .query(`
        SELECT am.id AS id_asignacion, am.estado, am.fecha_inicio, am.fecha_fin, am.fecha_asignacion,
               am.id_envio, am.id_vehiculo, am.id_recogida_entrega, am.id_tipo_transporte,
               e.estado AS estado_envio, e.fecha_creacion, e.id_usuario, e.id_ubicacion_mongo,
               v.placa, v.tipo AS tipo_vehiculo,
               tp.nombre AS tipo_transporte, tp.descripcion AS descripcion_transporte,
               u.nombre AS nombre_cliente, u.apellido AS apellido_cliente
        FROM AsignacionMultiple am
        INNER JOIN Envios e ON am.id_envio = e.id
        LEFT JOIN Vehiculos v ON am.id_vehiculo = v.id
        LEFT JOIN TipoTransporte tp ON am.id_tipo_transporte = tp.id
        LEFT JOIN Usuarios u ON e.id_usuario = u.id
        WHERE am.id_transportista = @id_transportista
      `);

    const asignaciones = result.recordset;

    // 3️⃣ Enriquecer cada asignación
    const enviosCompletos = await Promise.all(asignaciones.map(async asignacion => {
      const envio = { ...asignacion };

      try {
        // Obtener cargas específicas de esta asignación
        const cargas = await pool.request()
          .input('id_asignacion', sql.Int, asignacion.id_asignacion)
          .query(`
            SELECT c.*
            FROM AsignacionCarga ac
            INNER JOIN Carga c ON ac.id_carga = c.id
            WHERE ac.id_asignacion = @id_asignacion
          `);
        envio.cargas = cargas.recordset;

        // Obtener datos de recogida/entrega
        const recogidaRes = await pool.request()
          .input('id', sql.Int, asignacion.id_recogida_entrega)
          .query('SELECT * FROM RecogidaEntrega WHERE id = @id');
        envio.recogidaEntrega = recogidaRes.recordset[0];

        // Obtener ubicación MongoDB
        const ubicacion = await Direccion.findById(asignacion.id_ubicacion_mongo);
        if (ubicacion) {
          envio.nombre_origen = ubicacion.nombreOrigen;
          envio.nombre_destino = ubicacion.nombreDestino;
          envio.coordenadas_origen = ubicacion.coordenadasOrigen;
          envio.coordenadas_destino = ubicacion.coordenadasDestino;
          envio.rutaGeoJSON = ubicacion.rutaGeoJSON;
        }
      } catch (err) {
        console.warn("⚠️ Error enriqueciendo envío ID:", asignacion.id_envio, err.message);
      }

      return envio;
    }));

    res.json(enviosCompletos);

  } catch (err) {
    console.error('❌ Error al obtener envíos del transportista:', err);
    res.status(500).json({ error: 'Error interno al obtener los envíos' });
  }
}




// 8.- Finalizar envío (transportista)
async function finalizarEnvio(req, res) {
  const id_asignacion = parseInt(req.params.id);
  const id_usuario = req.usuario.id;

  if (isNaN(id_asignacion)) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  try {
    const pool = await poolPromise;

    // 1️⃣ Obtener ID del transportista autenticado
    const transportistaRes = await pool.request()
      .input('id_usuario', sql.Int, id_usuario)
      .query(`SELECT id FROM Transportistas WHERE id_usuario = @id_usuario`);

    if (transportistaRes.recordset.length === 0) {
      return res.status(403).json({ error: 'No tienes permisos para esta acción' });
    }

    const id_transportista = transportistaRes.recordset[0].id;

    // 2️⃣ Obtener asignación
    const asignacionRes = await pool.request()
      .input('id', sql.Int, id_asignacion)
      .query(`SELECT * FROM AsignacionMultiple WHERE id = @id`);

    if (asignacionRes.recordset.length === 0) {
      return res.status(404).json({ error: 'Asignación no encontrada' });
    }

    const asignacion = asignacionRes.recordset[0];

    // 3️⃣ Validar que le pertenece al transportista y esté en curso
    if (asignacion.id_transportista !== id_transportista) {
      return res.status(403).json({ error: 'No tienes permiso para finalizar esta asignación' });
    }

    if (asignacion.estado !== 'En curso') {
      return res.status(400).json({ error: 'Esta asignación no está en curso' });
    }

    // 4️⃣ Validar que exista checklist de incidentes
    const checklistRes = await pool.request()
      .input('id_asignacion', sql.Int, id_asignacion)
      .query(`SELECT id FROM ChecklistIncidentesTransporte WHERE id_asignacion = @id_asignacion`);

    if (checklistRes.recordset.length === 0) {
      return res.status(400).json({ error: 'Debes completar el checklist de incidentes antes de finalizar el viaje.' });
    }

    // 5️⃣ Validar que exista firma en MongoDB
    const firma = await FirmaEnvio.findOne({ id_asignacion: id_asignacion });
    if (!firma) {
      return res.status(400).json({ error: 'Debes capturar la firma del cliente antes de finalizar el viaje.' });
    }

    // 6️⃣ Actualizar asignación como finalizada
    await pool.request()
      .input('id', sql.Int, id_asignacion)
      .input('estado', sql.NVarChar, 'Entregado')
      .input('fecha_fin', sql.DateTime, new Date())
      .query(`
        UPDATE AsignacionMultiple
        SET estado = @estado, fecha_fin = @fecha_fin
        WHERE id = @id
      `);

    // 7️⃣ Liberar transportista y vehículo
    await pool.request()
      .input('id', sql.Int, asignacion.id_transportista)
      .query(`UPDATE Transportistas SET estado = 'Disponible' WHERE id = @id`);

    await pool.request()
      .input('id', sql.Int, asignacion.id_vehiculo)
      .query(`UPDATE Vehiculos SET estado = 'Disponible' WHERE id = @id`);

    // 8️⃣ ACTUALIZAR ESTADO GLOBAL DEL ENVÍO
    const asignaciones = await pool.request()
      .input('id_envio', sql.Int, asignacion.id_envio)
      .query(`SELECT estado FROM AsignacionMultiple WHERE id_envio = @id_envio`);

    const estados = asignaciones.recordset.map(a => a.estado);
    let nuevoEstado = 'Asignado';

    if (estados.length === 0) {
      nuevoEstado = 'Pendiente';
    } else if (estados.every(e => e === 'Entregado')) {
      nuevoEstado = 'Entregado';
    } else if (estados.every(e => e === 'Pendiente')) {
      nuevoEstado = 'Asignado';
    } else if (estados.some(e => e === 'Entregado') && estados.some(e => e !== 'Entregado')) {
      nuevoEstado = 'Parcialmente entregado';
    } else if (estados.some(e => e === 'En curso')) {
      nuevoEstado = 'En curso';
    }

    await pool.request()
      .input('id_envio', sql.Int, asignacion.id_envio)
      .input('estado', sql.NVarChar, nuevoEstado)
      .query('UPDATE Envios SET estado = @estado WHERE id = @id_envio');

    res.json({ mensaje: '✅ Asignación finalizada correctamente' });

  } catch (err) {
    console.error('❌ Error al finalizar asignación:', err);
    res.status(500).json({ error: 'Error interno al finalizar asignación' });
  }
}



// 9.- Registrar checklist de condiciones antes de iniciar viaje
async function registrarChecklistCondiciones(req, res) {
  const id_asignacion = parseInt(req.params.id);
  const id_usuario = req.usuario.id;

  const checklist = req.body;

  if (isNaN(id_asignacion)) {
    return res.status(400).json({ error: 'ID de asignación inválido' });
  }

  try {
    const pool = await poolPromise;

    // Verificar si el transportista autenticado corresponde a la asignación
    const validacion = await pool.request()
      .input('id', sql.Int, id_asignacion)
      .query(`
        SELECT am.*, t.id_usuario
        FROM AsignacionMultiple am
        INNER JOIN Transportistas t ON am.id_transportista = t.id
        WHERE am.id = @id
      `);

    const datos = validacion.recordset[0];

    if (!datos) return res.status(404).json({ error: 'Asignación no encontrada' });

    if (datos.id_usuario !== id_usuario) {
      return res.status(403).json({ error: 'No tienes permiso para esta asignación' });
    }

    if (datos.estado !== 'Pendiente') {
      return res.status(400).json({ error: 'El checklist solo se puede registrar si la asignación está pendiente' });
    }

    // Verificar si ya existe un checklist
    const yaExiste = await pool.request()
      .input('id_asignacion', sql.Int, id_asignacion)
      .query(`SELECT id FROM ChecklistCondicionesTransporte WHERE id_asignacion = @id_asignacion`);

    if (yaExiste.recordset.length > 0) {
      return res.status(400).json({ error: 'Este checklist ya fue registrado' });
    }

    // Insertar checklist
    await pool.request()
      .input('id_asignacion', sql.Int, id_asignacion)
      .input('temperatura_controlada', sql.Bit, checklist.temperatura_controlada)
      .input('embalaje_adecuado', sql.Bit, checklist.embalaje_adecuado)
      .input('carga_segura', sql.Bit, checklist.carga_segura)
      .input('vehiculo_limpio', sql.Bit, checklist.vehiculo_limpio)
      .input('documentos_presentes', sql.Bit, checklist.documentos_presentes)
      .input('ruta_conocida', sql.Bit, checklist.ruta_conocida)
      .input('combustible_completo', sql.Bit, checklist.combustible_completo)
      .input('gps_operativo', sql.Bit, checklist.gps_operativo)
      .input('comunicacion_funcional', sql.Bit, checklist.comunicacion_funcional)
      .input('estado_general_aceptable', sql.Bit, checklist.estado_general_aceptable)
      .input('observaciones', sql.NVarChar, checklist.observaciones || null)
      .query(`
        INSERT INTO ChecklistCondicionesTransporte (
          id_asignacion, temperatura_controlada, embalaje_adecuado, carga_segura,
          vehiculo_limpio, documentos_presentes, ruta_conocida, combustible_completo,
          gps_operativo, comunicacion_funcional, estado_general_aceptable, observaciones
        )
        VALUES (
          @id_asignacion, @temperatura_controlada, @embalaje_adecuado, @carga_segura,
          @vehiculo_limpio, @documentos_presentes, @ruta_conocida, @combustible_completo,
          @gps_operativo, @comunicacion_funcional, @estado_general_aceptable, @observaciones
        )
      `);

    res.status(201).json({ mensaje: '✅ Checklist de condiciones registrado correctamente' });

  } catch (err) {
    console.error('❌ Error al registrar checklist de condiciones:', err);
    res.status(500).json({ error: 'Error interno al registrar checklist' });
  }
}


// 10.- Registrar checklist de incidentes luego de iniciar el viaje
async function registrarChecklistIncidentes(req, res) {
  const id_asignacion = parseInt(req.params.id); // ahora usamos ID de AsignacionMultiple
  const checklist = req.body;
  const id_usuario = req.usuario.id;

  if (isNaN(id_asignacion)) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  try {
    const pool = await poolPromise;

    // 1️⃣ Validar que la asignación exista y pertenezca al transportista autenticado
    const validacion = await pool.request()
      .input('id', sql.Int, id_asignacion)
      .query(`
        SELECT am.*, t.id_usuario
        FROM AsignacionMultiple am
        INNER JOIN Transportistas t ON am.id_transportista = t.id
        WHERE am.id = @id
      `);

    const asignacion = validacion.recordset[0];

    if (!asignacion) {
      return res.status(404).json({ error: 'Asignación no encontrada' });
    }

    if (asignacion.id_usuario !== id_usuario) {
      return res.status(403).json({ error: 'No tienes permiso para esta asignación' });
    }

    // 🛠️ CAMBIO: Ahora permitimos registrar checklist cuando la asignación esté EN CURSO
    if (asignacion.estado !== 'En curso') {
      return res.status(400).json({ error: 'Solo puedes registrar el checklist si el viaje está en curso' });
    }

    // 2️⃣ Validar si ya existe un checklist de incidentes para esta asignación
    const yaExiste = await pool.request()
      .input('id_asignacion', sql.Int, id_asignacion)
      .query(`SELECT id FROM ChecklistIncidentesTransporte WHERE id_asignacion = @id_asignacion`);

    if (yaExiste.recordset.length > 0) {
      return res.status(400).json({ error: 'El checklist ya fue registrado' });
    }

    // 3️⃣ Insertar el nuevo checklist de incidentes
    await pool.request()
      .input('id_asignacion', sql.Int, id_asignacion)
      .input('retraso', sql.Bit, checklist.retraso)
      .input('problema_mecanico', sql.Bit, checklist.problema_mecanico)
      .input('accidente', sql.Bit, checklist.accidente)
      .input('perdida_carga', sql.Bit, checklist.perdida_carga)
      .input('condiciones_climaticas_adversas', sql.Bit, checklist.condiciones_climaticas_adversas)
      .input('ruta_alternativa_usada', sql.Bit, checklist.ruta_alternativa_usada)
      .input('contacto_cliente_dificultoso', sql.Bit, checklist.contacto_cliente_dificultoso)
      .input('parada_imprevista', sql.Bit, checklist.parada_imprevista)
      .input('problemas_documentacion', sql.Bit, checklist.problemas_documentacion)
      .input('otros_incidentes', sql.Bit, checklist.otros_incidentes)
      .input('descripcion_incidente', sql.NVarChar, checklist.descripcion_incidente || null)
      .query(`
        INSERT INTO ChecklistIncidentesTransporte (
          id_asignacion, retraso, problema_mecanico, accidente, perdida_carga,
          condiciones_climaticas_adversas, ruta_alternativa_usada,
          contacto_cliente_dificultoso, parada_imprevista, problemas_documentacion,
          otros_incidentes, descripcion_incidente
        )
        VALUES (
          @id_asignacion, @retraso, @problema_mecanico, @accidente, @perdida_carga,
          @condiciones_climaticas_adversas, @ruta_alternativa_usada,
          @contacto_cliente_dificultoso, @parada_imprevista, @problemas_documentacion,
          @otros_incidentes, @descripcion_incidente
        )
      `);

    res.status(201).json({ mensaje: '✅ Checklist de incidentes registrado correctamente' });

  } catch (err) {
    console.error('❌ Error al guardar checklist de incidentes:', err);
    res.status(500).json({ error: 'Error interno al registrar el checklist' });
  }
}





async function actualizarEstadoGlobalEnvio(id_envio, pool) {
  // 1️⃣ Obtener todos los estados de las asignaciones del envío
  const asignaciones = await pool.request()
    .input('id_envio', sql.Int, id_envio)
    .query(`SELECT estado FROM AsignacionMultiple WHERE id_envio = @id_envio`);

  const estados = asignaciones.recordset.map(a => a.estado);

  // 2️⃣ Determinar el estado global del envío
  let nuevoEstado = 'Asignado';

  if (estados.length === 0) {
    nuevoEstado = 'Pendiente';
  } else if (estados.every(e => e === 'Entregado')) {
    nuevoEstado = 'Entregado';
  } else if (estados.every(e => e === 'Pendiente')) {
    nuevoEstado = 'Asignado';
  } else if (estados.some(e => e === 'Entregado') && estados.some(e => e !== 'Entregado')) {
    nuevoEstado = 'Parcialmente entregado';
  } else if (estados.some(e => e === 'En curso')) {
    nuevoEstado = 'En curso';
  }
  
  // 3️⃣ Actualizar estado del envío
  await pool.request()
    .input('id_envio', sql.Int, id_envio)
    .input('estado', sql.NVarChar, nuevoEstado)
    .query(`UPDATE Envios SET estado = @estado WHERE id = @id_envio`);
}



// 11. Endpoint: Generar Documento de Envío completo
async function generarDocumentoEnvio(req, res) {
  const id_envio = parseInt(req.params.id_envio);
  const rol = req.usuario.rol; 
  const id_usuario = req.usuario.id;

  if (isNaN(id_envio)) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  try {
    const pool = await poolPromise;

    // 1️⃣ Obtener datos del envío
    const envioRes = await pool.request()
      .input('id', sql.Int, id_envio)
      .query(`
        SELECT e.*, u.nombre AS nombre_cliente, u.apellido AS apellido_cliente
        FROM Envios e
        INNER JOIN Usuarios u ON e.id_usuario = u.id
        WHERE e.id = @id
      `);

    if (envioRes.recordset.length === 0) {
      return res.status(404).json({ error: 'Envío no encontrado' });
    }

    const envio = envioRes.recordset[0];

    // 🔒 Validar si el envío está completamente ENTREGADO
    if (envio.estado !== 'Entregado') {
      return res.status(400).json({ error: 'El documento solo se puede generar cuando el envío esté completamente entregado.' });
    }

    // 🔒 Validar si el cliente tiene permiso (si no es admin)
    if (rol !== 'admin' && envio.id_usuario !== id_usuario) {
      return res.status(403).json({ error: 'No tienes acceso a este envío' });
    }

    // 2️⃣ Obtener ubicación (MongoDB)
    let ubicacion = null;
    try {
      ubicacion = await Direccion.findById(envio.id_ubicacion_mongo).lean();
    } catch (errMongo) {
      console.warn('⚠️ Error obteniendo ubicación MongoDB:', errMongo.message);
    }

    // 3️⃣ Obtener particiones (asignaciones)
    const asignacionesRes = await pool.request()
      .input('id_envio', sql.Int, id_envio)
      .query(`
        SELECT am.*, 
               u.nombre AS nombre_transportista, u.apellido AS apellido_transportista,
               t.ci AS ci_transportista, t.telefono AS telefono_transportista,
               v.placa, v.tipo AS tipo_vehiculo,
               tp.nombre AS nombre_tipo_transporte, tp.descripcion AS descripcion_tipo_transporte
        FROM AsignacionMultiple am
        LEFT JOIN Transportistas t ON am.id_transportista = t.id
        LEFT JOIN Usuarios u ON t.id_usuario = u.id
        LEFT JOIN Vehiculos v ON am.id_vehiculo = v.id
        LEFT JOIN TipoTransporte tp ON am.id_tipo_transporte = tp.id
        WHERE am.id_envio = @id_envio
      `);

    const asignaciones = asignacionesRes.recordset;

    // 4️⃣ Obtener cargas, firma, checklist y recogidaEntrega por cada asignación
    const particiones = await Promise.all(asignaciones.map(async asignacion => {
      // 🔄 Obtener las cargas asociadas
      const cargasRes = await pool.request()
        .input('id_asignacion', sql.Int, asignacion.id)
        .query(`
          SELECT c.*
          FROM AsignacionCarga ac
          INNER JOIN Carga c ON ac.id_carga = c.id
          WHERE ac.id_asignacion = @id_asignacion
        `);

      // 🔄 Obtener datos de recogida y entrega
      const recogidaEntregaRes = await pool.request()
        .input('id_asignacion', sql.Int, asignacion.id)
        .query(`
          SELECT fecha_recogida, hora_recogida, hora_entrega, instrucciones_recogida, instrucciones_entrega
          FROM RecogidaEntrega
          WHERE id_asignacion = @id_asignacion
        `);
      
      const recogidaEntrega = recogidaEntregaRes.recordset[0] || {};

      // 🔄 Obtener firma (MongoDB)
      const firma = await FirmaEnvio.findOne({ id_asignacion: asignacion.id }).lean();

      // 🔄 Obtener checklist (si es admin)
      let checklistCondiciones = null;
      let checklistIncidentes = null;

      if (rol === 'admin') {
        const condicionesRes = await pool.request()
          .input('id_asignacion', sql.Int, asignacion.id)
          .query(`SELECT * FROM ChecklistCondicionesTransporte WHERE id_asignacion = @id_asignacion`);
        checklistCondiciones = condicionesRes.recordset[0] || null;

        const incidentesRes = await pool.request()
          .input('id_asignacion', sql.Int, asignacion.id)
          .query(`SELECT * FROM ChecklistIncidentesTransporte WHERE id_asignacion = @id_asignacion`);
        checklistIncidentes = incidentesRes.recordset[0] || null;
      }

      return {
        id_asignacion: asignacion.id,
        estado: asignacion.estado,
        fecha_asignacion: asignacion.fecha_asignacion,
        fecha_inicio: asignacion.fecha_inicio,
        fecha_fin: asignacion.fecha_fin,
        transportista: {
          nombre: asignacion.nombre_transportista,
          apellido: asignacion.apellido_transportista,
          telefono: asignacion.telefono_transportista,
          ci: asignacion.ci_transportista
        },
        vehiculo: {
          placa: asignacion.placa,
          tipo: asignacion.tipo_vehiculo
        },
        tipo_transporte: {
          nombre: asignacion.nombre_tipo_transporte,
          descripcion: asignacion.descripcion_tipo_transporte
        },
        recogidaEntrega: {
          fecha_recogida: recogidaEntrega.fecha_recogida || null,
          hora_recogida: recogidaEntrega.hora_recogida || null,
          hora_entrega: recogidaEntrega.hora_entrega || null,
          instrucciones_recogida: recogidaEntrega.instrucciones_recogida || "Sin instrucciones",
          instrucciones_entrega: recogidaEntrega.instrucciones_entrega || "Sin instrucciones"
        },
        cargas: cargasRes.recordset,
        firma: firma ? firma.imagenFirma : null,
        checklistCondiciones,
        checklistIncidentes
      };
    }));

    // 5️⃣ Preparar respuesta final
    res.json({
      id_envio: envio.id,
      nombre_cliente: `${envio.nombre_cliente} ${envio.apellido_cliente}`,
      estado: envio.estado,
      fecha_creacion: envio.fecha_creacion,
      fecha_inicio: envio.fecha_inicio,
      fecha_entrega: envio.fecha_entrega,
      nombre_origen: ubicacion?.nombreOrigen || '—',
      nombre_destino: ubicacion?.nombreDestino || '—',
      particiones
    });

  } catch (error) {
    console.error('❌ Error al generar documento:', error);
    res.status(500).json({ error: 'Error interno al generar documento' });
  }
}


// 12. Endpoint: Generar Documento de Partición (asignación específica)
async function generarDocumentoParticion(req, res) {
  const id_asignacion = parseInt(req.params.id_asignacion);
  const rol = req.usuario.rol;
  const id_usuario = req.usuario.id;

  if (isNaN(id_asignacion)) {
    return res.status(400).json({ error: 'ID de asignación inválido' });
  }

  try {
    const pool = await poolPromise;

    // 1️⃣ Obtener asignación + datos del envío
    const asignacionRes = await pool.request()
      .input('id_asignacion', sql.Int, id_asignacion)
      .query(`
        SELECT am.*, 
               e.id_usuario AS id_usuario_cliente,
               e.id AS id_envio,
               e.estado AS estado_envio,
               e.fecha_creacion, e.fecha_inicio, e.fecha_entrega,
               e.id_ubicacion_mongo,
               u.nombre AS nombre_cliente, u.apellido AS apellido_cliente,
               v.placa, v.tipo AS tipo_vehiculo,
               t.ci AS ci_transportista, t.telefono AS telefono_transportista,
               ut.nombre AS nombre_transportista, ut.apellido AS apellido_transportista,
               tp.nombre AS nombre_tipo_transporte, tp.descripcion AS descripcion_tipo_transporte
        FROM AsignacionMultiple am
        INNER JOIN Envios e ON am.id_envio = e.id
        INNER JOIN Usuarios u ON e.id_usuario = u.id
        LEFT JOIN Vehiculos v ON am.id_vehiculo = v.id
        LEFT JOIN Transportistas t ON am.id_transportista = t.id
        LEFT JOIN Usuarios ut ON t.id_usuario = ut.id
        LEFT JOIN TipoTransporte tp ON am.id_tipo_transporte = tp.id
        WHERE am.id = @id_asignacion
      `);

    if (asignacionRes.recordset.length === 0) {
      return res.status(404).json({ error: 'Asignación no encontrada' });
    }

    const asignacion = asignacionRes.recordset[0];

    // 2️⃣ Validar permisos
    if (rol !== 'admin' && asignacion.id_usuario_cliente !== id_usuario) {
      return res.status(403).json({ error: 'No tienes acceso a esta asignación' });
    }

    // 3️⃣ Obtener ubicación (MongoDB)
    let ubicacion = null;
    try {
      ubicacion = await Direccion.findById(asignacion.id_ubicacion_mongo).lean();
    } catch (errMongo) {
      console.warn('⚠️ Error obteniendo ubicación MongoDB:', errMongo.message);
    }

    // 4️⃣ Obtener cargas asociadas a esta asignación
    const cargasRes = await pool.request()
      .input('id_asignacion', sql.Int, id_asignacion)
      .query(`
        SELECT c.*
        FROM AsignacionCarga ac
        INNER JOIN Carga c ON ac.id_carga = c.id
        WHERE ac.id_asignacion = @id_asignacion
      `);

    // 5️⃣ Obtener datos de recogida y entrega
    const recogidaEntregaRes = await pool.request()
      .input('id_asignacion', sql.Int, id_asignacion)
      .query(`
        SELECT fecha_recogida, hora_recogida, hora_entrega, instrucciones_recogida, instrucciones_entrega
        FROM RecogidaEntrega
        WHERE id_asignacion = @id_asignacion
      `);

    const recogidaEntrega = recogidaEntregaRes.recordset[0] || {};

    // 6️⃣ Obtener firma (MongoDB)
    const firma = await FirmaEnvio.findOne({ id_asignacion }).lean();

    // 7️⃣ Obtener checklist (si es admin)
    let checklistCondiciones = null;
    let checklistIncidentes = null;

    if (rol === 'admin') {
      const condicionesRes = await pool.request()
        .input('id_asignacion', sql.Int, id_asignacion)
        .query(`SELECT * FROM ChecklistCondicionesTransporte WHERE id_asignacion = @id_asignacion`);
      checklistCondiciones = condicionesRes.recordset[0] || null;

      const incidentesRes = await pool.request()
        .input('id_asignacion', sql.Int, id_asignacion)
        .query(`SELECT * FROM ChecklistIncidentesTransporte WHERE id_asignacion = @id_asignacion`);
      checklistIncidentes = incidentesRes.recordset[0] || null;
    }

    // 8️⃣ Preparar respuesta final
    res.json({
      id_envio: asignacion.id_envio,
      nombre_cliente: `${asignacion.nombre_cliente} ${asignacion.apellido_cliente}`,
      estado_envio: asignacion.estado_envio,
      fecha_creacion: asignacion.fecha_creacion,
      fecha_inicio: asignacion.fecha_inicio,
      fecha_entrega: asignacion.fecha_entrega,
      nombre_origen: ubicacion?.nombreOrigen || '—',
      nombre_destino: ubicacion?.nombreDestino || '—',
      particion: {
        id_asignacion: asignacion.id,
        estado: asignacion.estado,
        fecha_asignacion: asignacion.fecha_asignacion,
        fecha_inicio: asignacion.fecha_inicio,
        fecha_fin: asignacion.fecha_fin,
        transportista: {
          nombre: asignacion.nombre_transportista,
          apellido: asignacion.apellido_transportista,
          telefono: asignacion.telefono_transportista,
          ci: asignacion.ci_transportista
        },
        vehiculo: {
          placa: asignacion.placa,
          tipo: asignacion.tipo_vehiculo
        },
        tipo_transporte: {
          nombre: asignacion.nombre_tipo_transporte,
          descripcion: asignacion.descripcion_tipo_transporte
        },
        recogidaEntrega: {
          fecha_recogida: recogidaEntrega.fecha_recogida || null,
          hora_recogida: recogidaEntrega.hora_recogida || null,
          hora_entrega: recogidaEntrega.hora_entrega || null,
          instrucciones_recogida: recogidaEntrega.instrucciones_recogida || "Sin instrucciones",
          instrucciones_entrega: recogidaEntrega.instrucciones_entrega || "Sin instrucciones"
        },
        cargas: cargasRes.recordset,
        firma: firma ? firma.imagenFirma : null,
        checklistCondiciones,
        checklistIncidentes
      }
    });

  } catch (error) {
    console.error('❌ Error al generar documento de partición:', error);
    res.status(500).json({ error: 'Error interno al generar documento' });
  }
}



module.exports = {
  crearEnvioCompleto,
  obtenerTodos,
  obtenerPorId,
  asignarTransportistaYVehiculo,
  asignarTransportistaYVehiculoAParticion,
  obtenerMisEnvios,
  iniciarViaje,
  obtenerEnviosAsignadosTransportista,
  finalizarEnvio,
  registrarChecklistCondiciones,
  registrarChecklistIncidentes,
  actualizarEstadoGlobalEnvio,
  generarDocumentoEnvio,
  generarDocumentoParticion
};
