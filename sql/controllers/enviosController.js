const { sql, poolPromise } = require('../../config/sqlserver');
const Direccion = require('../../mongo/models/ubicacion');

// 1.- Crear envios completos
async function crearEnvioCompleto(req, res) {
  const {
    id_ubicacion_mongo,
    id_transportista,
    id_vehiculo,
    id_tipo_transporte,
    carga,
    recogidaEntrega
  } = req.body;

  const rol = req.usuario.rol;
  const id_usuario = req.usuario.id;

  if (!id_ubicacion_mongo || !id_tipo_transporte || !carga || !recogidaEntrega) {
    return res.status(400).json({ error: 'Faltan datos requeridos del envío completo' });
  }

  if (rol === 'cliente' && (id_transportista || id_vehiculo)) {
    return res.status(403).json({ error: 'Los clientes no pueden asignar transportista ni vehículo' });
  }

  try {
    const pool = await poolPromise;

    // ✅ Validar disponibilidad si es admin
    if (rol === 'admin' && id_transportista && id_vehiculo) {
      const [estadoT, estadoV] = await Promise.all([
        pool.request().input('id', sql.Int, id_transportista)
          .query(`SELECT estado FROM Transportistas WHERE id = @id`),
        pool.request().input('id', sql.Int, id_vehiculo)
          .query(`SELECT estado FROM Vehiculos WHERE id = @id`)
      ]);

      if (estadoT.recordset[0]?.estado !== 'Disponible' || estadoV.recordset[0]?.estado !== 'Disponible') {
        return res.status(400).json({ error: '❌ Transportista o vehículo no disponibles' });
      }
    }

    // ✅ Insertar carga
    const cargaResult = await pool.request()
      .input('tipo', sql.NVarChar, carga.tipo)
      .input('variedad', sql.NVarChar, carga.variedad)
      .input('cantidad', sql.Int, carga.cantidad)
      .input('empaquetado', sql.NVarChar, carga.empaquetado)
      .input('peso', sql.Decimal(10, 2), carga.peso)
      .query(`
        INSERT INTO Carga (tipo, variedad, cantidad, empaquetado, peso)
        OUTPUT INSERTED.id VALUES (@tipo, @variedad, @cantidad, @empaquetado, @peso)
      `);
    const id_carga = cargaResult.recordset[0].id;

    // ✅ Insertar recogida/entrega
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

    // ✅ Insertar envío
    const envioResult = await pool.request()
      .input('id_usuario', sql.Int, id_usuario)
      .input('id_ubicacion_mongo', sql.NVarChar, id_ubicacion_mongo)
      .input('id_recogida_entrega', sql.Int, id_recogida_entrega)
      .input('id_tipo_transporte', sql.Int, id_tipo_transporte)
      .input('estado', sql.NVarChar, rol === 'admin' ? 'Asignado' : 'Pendiente')
      .query(`
        INSERT INTO Envios (id_usuario, id_ubicacion_mongo, id_recogida_entrega, id_tipo_transporte, estado)
        OUTPUT INSERTED.id VALUES (@id_usuario, @id_ubicacion_mongo, @id_recogida_entrega, @id_tipo_transporte, @estado)
      `);
    const id_envio = envioResult.recordset[0].id;

    // ✅ Insertar en EnvioCarga
    await pool.request()
      .input('id_envio', sql.Int, id_envio)
      .input('id_carga', sql.Int, id_carga)
      .query(`
        INSERT INTO EnvioCarga (id_envio, id_carga)
        VALUES (@id_envio, @id_carga)
      `);

    // ✅ Insertar en AsignacionMultiple (solo si es admin y asigna)
    if (rol === 'admin' && id_transportista && id_vehiculo) {
      await pool.request()
        .input('id_envio', sql.Int, id_envio)
        .input('id_transportista', sql.Int, id_transportista)
        .input('id_vehiculo', sql.Int, id_vehiculo)
        .input('estado', sql.NVarChar, 'Pendiente')
        .query(`
          INSERT INTO AsignacionMultiple (id_envio, id_transportista, id_vehiculo, estado)
          VALUES (@id_envio, @id_transportista, @id_vehiculo, @estado)
        `);

      await pool.request()
        .input('id', sql.Int, id_transportista)
        .query(`UPDATE Transportistas SET estado = 'No Disponible' WHERE id = @id`);

      await pool.request()
        .input('id', sql.Int, id_vehiculo)
        .query(`UPDATE Vehiculos SET estado = 'No Disponible' WHERE id = @id`);
    }

    res.status(201).json({
      mensaje: '✅ Envío completo creado correctamente',
      id_envio
    });

  } catch (err) {
    console.error('❌ Error al crear envío completo:', err);
    res.status(500).json({ error: 'Error al crear envío completo' });
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
        u.rol AS rol_usuario, 
        r.fecha_recogida, 
        r.hora_recogida, 
        r.hora_entrega,
        r.instrucciones_recogida, 
        r.instrucciones_entrega,
        tp.nombre AS tipo_transporte
      FROM Envios e
      LEFT JOIN Usuarios u ON e.id_usuario = u.id
      LEFT JOIN RecogidaEntrega r ON e.id_recogida_entrega = r.id
      LEFT JOIN TipoTransporte tp ON e.id_tipo_transporte = tp.id
    `;

    if (usuario.rol !== 'admin') {
      query += ' WHERE e.id_usuario = @id_usuario';
      request.input('id_usuario', sql.Int, usuario.id);
    }

    const result = await request.query(query);
    const enviosBase = result.recordset;

    // 🔁 Enriquecer cada envío con cargas, asignaciones y ubicación
    const enviosCompletos = await Promise.all(enviosBase.map(async envio => {
      try {
        // CARGAS
        const cargasRes = await pool.request()
          .input('id_envio', sql.Int, envio.id)
          .query(`
            SELECT c.*
            FROM EnvioCarga ec
            INNER JOIN Carga c ON ec.id_carga = c.id
            WHERE ec.id_envio = @id_envio
          `);
        envio.cargas = cargasRes.recordset;

        // ASIGNACIONES
        const asignacionesRes = await pool.request()
          .input('id_envio', sql.Int, envio.id)
          .query(`
            SELECT am.*, 
                   t.ci AS ci_transportista, 
                   t.telefono AS telefono_transportista, 
                   v.placa, 
                   v.tipo AS tipo_vehiculo
            FROM AsignacionMultiple am
            LEFT JOIN Transportistas t ON am.id_transportista = t.id
            LEFT JOIN Vehiculos v ON am.id_vehiculo = v.id
            WHERE am.id_envio = @id_envio
          `);
        envio.asignaciones = asignacionesRes.recordset;

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
               u.nombre AS nombre_usuario, u.apellido AS apellido_usuario,
               tp.nombre AS tipo_transporte, tp.descripcion AS descripcion_transporte,
               r.fecha_recogida, r.hora_recogida, r.hora_entrega,
               r.instrucciones_recogida, r.instrucciones_entrega
        FROM Envios e
        LEFT JOIN Usuarios u ON e.id_usuario = u.id
        LEFT JOIN RecogidaEntrega r ON e.id_recogida_entrega = r.id
        LEFT JOIN TipoTransporte tp ON e.id_tipo_transporte = tp.id
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

    // Obtener ubicación desde Mongo
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

    // === 🔁 NUEVO: Obtener asignaciones del envío
    const asignacionesRes = await pool.request()
      .input('id_envio', sql.Int, envioId)
      .query(`
        SELECT am.*, 
               u.nombre AS nombre_transportista, 
               u.apellido AS apellido_transportista,
               v.placa, v.tipo AS tipo_vehiculo
        FROM AsignacionMultiple am
        INNER JOIN Transportistas t ON am.id_transportista = t.id
        INNER JOIN Usuarios u ON t.id_usuario = u.id
        INNER JOIN Vehiculos v ON am.id_vehiculo = v.id
        WHERE am.id_envio = @id_envio
      `);

    envio.asignaciones = asignacionesRes.recordset;

    // Estado resumido (ej: "1 de 2 camiones activos")
    const total = envio.asignaciones.length;
    const activos = envio.asignaciones.filter(a => a.estado === 'En curso').length;
    envio.estado_resumen = `En curso (${activos} de ${total} camiones activos)`;

    return res.json(envio);

  } catch (err) {
    console.error('❌ Error al obtener envío por ID:', err);
    return res.status(500).json({ error: 'Error al obtener el envío' });
  }
}




// 4.- Asignar transportista y vehículo (solo admin)
async function asignarTransportistaYVehiculo(req, res) {
  const id_envio = parseInt(req.params.id);
  const { id_transportista, id_vehiculo } = req.body;

  if (!id_transportista || !id_vehiculo) {
    return res.status(400).json({ error: 'Faltan datos' });
  }

  try {
    const pool = await poolPromise;

    // ✅ Verificar disponibilidad de transportista y vehículo
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
      return res.status(400).json({ error: '❌ Transportista o vehículo no están disponibles' });
    }

    // ✅ Verificar si el envío existe
    const envioExiste = await pool.request()
      .input('id_envio', sql.Int, id_envio)
      .query('SELECT id FROM Envios WHERE id = @id_envio');

    if (envioExiste.recordset.length === 0) {
      return res.status(404).json({ error: 'Envío no encontrado' });
    }

    // ✅ Insertar asignación
    await pool.request()
      .input('id_envio', sql.Int, id_envio)
      .input('id_transportista', sql.Int, id_transportista)
      .input('id_vehiculo', sql.Int, id_vehiculo)
      .input('estado', sql.NVarChar, 'Pendiente')
      .query(`
        INSERT INTO AsignacionMultiple (id_envio, id_transportista, id_vehiculo, estado)
        VALUES (@id_envio, @id_transportista, @id_vehiculo, @estado)
      `);

    // ✅ Actualizar estados a No Disponible
    await pool.request()
      .input('id', sql.Int, id_transportista)
      .query(`UPDATE Transportistas SET estado = 'No Disponible' WHERE id = @id`);

    await pool.request()
      .input('id', sql.Int, id_vehiculo)
      .query(`UPDATE Vehiculos SET estado = 'No Disponible' WHERE id = @id`);

    res.json({ mensaje: '✅ Transportista y vehículo asignados correctamente' });

  } catch (err) {
    console.error('❌ Error al asignar:', err);
    res.status(500).json({ error: 'Error al asignar transporte' });
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
               u.rol AS rol_usuario,  
               r.fecha_recogida, r.hora_recogida, r.hora_entrega,
               r.instrucciones_recogida, r.instrucciones_entrega,
               tp.nombre AS tipo_transporte
        FROM Envios e
        LEFT JOIN Usuarios u ON e.id_usuario = u.id
        LEFT JOIN RecogidaEntrega r ON e.id_recogida_entrega = r.id
        LEFT JOIN TipoTransporte tp ON e.id_tipo_transporte = tp.id
        WHERE e.id_usuario = @id_usuario
      `);

    const envios = resultado.recordset;

    // 2️⃣ Enriquecer con cargas, asignaciones y ubicación (Mongo)
    const enviosCompletos = await Promise.all(envios.map(async envio => {
      try {
        // Obtener cargas del envío
        const cargas = await pool.request()
          .input('id_envio', sql.Int, envio.id)
          .query(`
            SELECT c.*
            FROM EnvioCarga ec
            INNER JOIN Carga c ON ec.id_carga = c.id
            WHERE ec.id_envio = @id_envio
          `);
        envio.cargas = cargas.recordset;

        // Obtener asignaciones del envío
        const asignaciones = await pool.request()
          .input('id_envio', sql.Int, envio.id)
          .query(`
            SELECT am.*, 
                   t.ci AS ci_transportista,
                   t.telefono AS telefono_transportista,
                   v.placa, v.tipo AS tipo_vehiculo
            FROM AsignacionMultiple am
            LEFT JOIN Transportistas t ON am.id_transportista = t.id
            LEFT JOIN Vehiculos v ON am.id_vehiculo = v.id
            WHERE am.id_envio = @id_envio
          `);
        envio.asignaciones = asignaciones.recordset;

        // Obtener ubicación MongoDB
        try {
          const ubicacion = await Direccion.findById(envio.id_ubicacion_mongo);
          if (ubicacion) {
            envio.nombre_origen = ubicacion.nombreOrigen || "—";
            envio.nombre_destino = ubicacion.nombreDestino || "—";
          }
        } catch (err) {
          envio.nombre_origen = "—";
          envio.nombre_destino = "—";
        }

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
  const id_asignacion = parseInt(req.params.id); // ID de AsignacionMultiple
  const userId = req.usuario.id;
  const rol = req.usuario.rol;

  if (rol !== 'transportista') {
    return res.status(403).json({ error: 'Solo los transportistas pueden iniciar el viaje' });
  }

  try {
    const pool = await poolPromise;

    // 1️⃣ Obtener ID de transportista autenticado
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
      .query(`
        SELECT * FROM AsignacionMultiple 
        WHERE id = @id_asignacion AND id_transportista = ${id_transportista} AND estado = 'Pendiente'
      `);

    if (asignacionRes.recordset.length === 0) {
      return res.status(403).json({ error: 'No tienes acceso o la asignación no está disponible para iniciar' });
    }

    const asignacion = asignacionRes.recordset[0];

    // 3️⃣ Verificar checklist por asignación
    const checklistRes = await pool.request()
      .input('id_asignacion', sql.Int, id_asignacion)
      .query(`SELECT id FROM ChecklistCondicionesTransporte WHERE id_asignacion = @id_asignacion`);

    if (checklistRes.recordset.length === 0) {
      return res.status(400).json({ error: 'Debes completar el checklist antes de iniciar el viaje' });
    }

    // 4️⃣ Actualizar la asignación como "En curso" y guardar la fecha de inicio
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

    // 6️⃣ NUEVO: Actualizar estado global del envío
    const asignaciones = await pool.request()
      .input('id_envio', sql.Int, asignacion.id_envio)
      .query(`SELECT estado FROM AsignacionMultiple WHERE id_envio = @id_envio`);

      const estados = asignaciones.recordset.map(a => a.estado);
      let nuevoEstado = 'Asignado';
      
      if (estados.length === 0) {
        nuevoEstado = 'Pendiente';
      } else if (estados.every(e => e === 'Entregado')) {
        nuevoEstado = 'Entregado';
      } else if (estados.some(e => e === 'En curso')) {
        nuevoEstado = 'En curso';
      } else if (estados.every(e => e === 'Pendiente')) {
        nuevoEstado = 'Asignado';
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

    // Obtener ID del transportista autenticado
    const resultTransportista = await pool.request()
      .input('id_usuario', sql.Int, id_usuario)
      .query('SELECT id FROM Transportistas WHERE id_usuario = @id_usuario');

    if (resultTransportista.recordset.length === 0) {
      return res.status(404).json({ error: 'No eres un transportista válido' });
    }

    const id_transportista = resultTransportista.recordset[0].id;

    // Obtener asignaciones de este transportista
    const result = await pool.request()
      .input('id_transportista', sql.Int, id_transportista)
      .query(`
        SELECT am.id AS id_asignacion, 
               am.estado, am.fecha_inicio, am.fecha_fin, am.fecha_asignacion,
               am.id_envio, am.id_transportista, am.id_vehiculo,
               e.id_usuario, e.id_ubicacion_mongo, e.id_recogida_entrega,
               e.id_tipo_transporte, e.fecha_creacion, e.fecha_entrega,
               r.fecha_recogida, r.hora_recogida, r.hora_entrega,
               r.instrucciones_recogida, r.instrucciones_entrega,
               tp.nombre AS tipo_transporte
        FROM AsignacionMultiple am
        INNER JOIN Envios e ON am.id_envio = e.id
        LEFT JOIN RecogidaEntrega r ON e.id_recogida_entrega = r.id
        LEFT JOIN TipoTransporte tp ON e.id_tipo_transporte = tp.id
        WHERE am.id_transportista = @id_transportista
      `);

    const asignaciones = result.recordset;

    // Enriquecer cada asignación con cargas y ubicación Mongo
    const enviosCompletos = await Promise.all(asignaciones.map(async asignacion => {
      const envio = { ...asignacion };

      try {
        // Obtener cargas del envío
        const cargas = await pool.request()
          .input('id_envio', sql.Int, asignacion.id_envio)
          .query(`
            SELECT c.*
            FROM EnvioCarga ec
            INNER JOIN Carga c ON ec.id_carga = c.id
            WHERE ec.id_envio = @id_envio
          `);
        envio.cargas = cargas.recordset;

        // Enriquecer con Mongo
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

    // 4️⃣ Actualizar asignación como finalizada
    await pool.request()
      .input('id', sql.Int, id_asignacion)
      .input('estado', sql.NVarChar, 'Entregado')
      .input('fecha_fin', sql.DateTime, new Date())
      .query(`
        UPDATE AsignacionMultiple
        SET estado = @estado, fecha_fin = @fecha_fin
        WHERE id = @id
      `);

    // 5️⃣ Liberar transportista y vehículo
    await pool.request()
      .input('id', sql.Int, asignacion.id_transportista)
      .query(`UPDATE Transportistas SET estado = 'Disponible' WHERE id = @id`);

    await pool.request()
      .input('id', sql.Int, asignacion.id_vehiculo)
      .query(`UPDATE Vehiculos SET estado = 'Disponible' WHERE id = @id`);

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
    } else if (estados.some(e => e === 'En curso')) {
      nuevoEstado = 'En curso';
    } else if (estados.every(e => e === 'Pendiente')) {
      nuevoEstado = 'Asignado';
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


// 10.- Registrar checklist de incidentes luego de finalizar viaje
// 10.- Registrar checklist de incidentes luego de finalizar viaje
async function registrarChecklistIncidentes(req, res) {
  const id_asignacion = parseInt(req.params.id); // ahora usamos ID de AsignacionMultiple
  const checklist = req.body;
  const id_usuario = req.usuario.id;

  if (isNaN(id_asignacion)) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  try {
    const pool = await poolPromise;

    // Validar que la asignación exista y pertenezca al transportista autenticado
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

    if (asignacion.estado !== 'Entregado') {
      return res.status(400).json({ error: 'Solo puedes registrar el checklist si ya finalizaste el viaje' });
    }

    // Validar si ya existe un checklist de incidentes para esta asignación
    const yaExiste = await pool.request()
      .input('id_asignacion', sql.Int, id_asignacion)
      .query(`SELECT id FROM ChecklistIncidentesTransporte WHERE id_asignacion = @id_asignacion`);

    if (yaExiste.recordset.length > 0) {
      return res.status(400).json({ error: 'El checklist ya fue registrado' });
    }

    // Insertar el nuevo checklist de incidentes
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
  } else if (estados.some(e => e === 'En curso')) {
    nuevoEstado = 'En curso';
  } else if (estados.every(e => e === 'Pendiente')) {
    nuevoEstado = 'Asignado';
  }

  // 3️⃣ Actualizar estado del envío
  await pool.request()
    .input('id_envio', sql.Int, id_envio)
    .input('estado', sql.NVarChar, nuevoEstado)
    .query(`UPDATE Envios SET estado = @estado WHERE id = @id_envio`);
}



module.exports = {
  crearEnvioCompleto,
  obtenerTodos,
  obtenerPorId,
  asignarTransportistaYVehiculo,
  obtenerMisEnvios,
  iniciarViaje,
  obtenerEnviosAsignadosTransportista,
  finalizarEnvio,
  registrarChecklistCondiciones,
  registrarChecklistIncidentes,
  actualizarEstadoGlobalEnvio
};
