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
  const id_usuario = req.usuario.id; // ✅ SE OBTIENE DESDE EL TOKEN

  if (!id_ubicacion_mongo || !id_tipo_transporte || !carga || !recogidaEntrega) {
    return res.status(400).json({ error: 'Faltan datos requeridos del envío completo' });
  }

  if (rol === 'cliente' && (id_transportista || id_vehiculo)) {
    return res.status(403).json({ error: 'Los clientes no pueden asignar transportista ni vehículo' });
  }

  try {
    const pool = await poolPromise;

    // ✅ Validar disponibilidad si es admin y asigna transportista/vehículo
    if (rol === 'admin' && id_transportista && id_vehiculo) {
      const [estadoT, estadoV] = await Promise.all([
        pool.request()
          .input('id', sql.Int, id_transportista)
          .query(`SELECT estado FROM Transportistas WHERE id = @id`),
        pool.request()
          .input('id', sql.Int, id_vehiculo)
          .query(`SELECT estado FROM Vehiculos WHERE id = @id`)
      ]);

      const estadoTransportista = estadoT.recordset[0]?.estado;
      const estadoVehiculo = estadoV.recordset[0]?.estado;

      if (estadoTransportista !== 'Disponible' || estadoVehiculo !== 'Disponible') {
        return res.status(400).json({ error: '❌ Transportista o vehículo no están disponibles' });
      }
    }

    // Insertar carga
    const cargaResult = await pool.request()
      .input('tipo', sql.NVarChar, carga.tipo)
      .input('variedad', sql.NVarChar, carga.variedad)
      .input('cantidad', sql.Int, carga.cantidad)
      .input('empaquetado', sql.NVarChar, carga.empaquetado)
      .input('peso', sql.Decimal(10, 2), carga.peso)
      .query(`INSERT INTO Carga (tipo, variedad, cantidad, empaquetado, peso)
              OUTPUT INSERTED.id VALUES (@tipo, @variedad, @cantidad, @empaquetado, @peso)`);
    const id_carga = cargaResult.recordset[0].id;

    // Insertar recogida/entrega
    const recogidaResult = await pool.request()
      .input('fecha_recogida', sql.Date, recogidaEntrega.fecha_recogida)
      .input('hora_recogida', sql.Time, new Date(`1970-01-01T${recogidaEntrega.hora_recogida}`))
      .input('hora_entrega', sql.Time, new Date(`1970-01-01T${recogidaEntrega.hora_entrega}`))
      .input('instrucciones_recogida', sql.NVarChar, recogidaEntrega.instrucciones_recogida || null)
      .input('instrucciones_entrega', sql.NVarChar, recogidaEntrega.instrucciones_entrega || null)
      .query(`INSERT INTO RecogidaEntrega (fecha_recogida, hora_recogida, hora_entrega, instrucciones_recogida, instrucciones_entrega)
              OUTPUT INSERTED.id VALUES (@fecha_recogida, @hora_recogida, @hora_entrega, @instrucciones_recogida, @instrucciones_entrega)`);
    const id_recogida_entrega = recogidaResult.recordset[0].id;

    // Insertar envío
    const envioRequest = pool.request()
      .input('id_usuario', sql.Int, id_usuario)
      .input('id_carga', sql.Int, id_carga)
      .input('id_ubicacion_mongo', sql.NVarChar, id_ubicacion_mongo)
      .input('id_recogida_entrega', sql.Int, id_recogida_entrega)
      .input('id_tipo_transporte', sql.Int, id_tipo_transporte)
      .input('estado', sql.NVarChar, rol === 'admin' ? 'Asignado' : 'Pendiente');

    if (rol === 'admin') {
      envioRequest
        .input('id_transportista', sql.Int, id_transportista || null)
        .input('id_vehiculo', sql.Int, id_vehiculo || null);
    } else {
      envioRequest
        .input('id_transportista', sql.Int, null)
        .input('id_vehiculo', sql.Int, null);
    }

    const envioResult = await envioRequest.query(`
      INSERT INTO Envios (id_usuario, id_carga, id_ubicacion_mongo, id_transportista, id_vehiculo, id_recogida_entrega, id_tipo_transporte, estado)
      OUTPUT INSERTED.id VALUES (@id_usuario, @id_carga, @id_ubicacion_mongo, @id_transportista, @id_vehiculo, @id_recogida_entrega, @id_tipo_transporte, @estado)
    `);

    const id_envio = envioResult.recordset[0].id;

    // ✅ Actualizar estado de transportista y vehículo si fueron asignados
    if (rol === 'admin' && id_transportista && id_vehiculo) {
      await pool.request()
        .input('estado', sql.NVarChar, 'No Disponible')
        .input('id', sql.Int, id_transportista)
        .query(`UPDATE Transportistas SET estado = @estado WHERE id = @id`);

      await pool.request()
        .input('estado', sql.NVarChar, 'No Disponible')
        .input('id', sql.Int, id_vehiculo)
        .query(`UPDATE Vehiculos SET estado = @estado WHERE id = @id`);
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
      SELECT e.*, 
             u.nombre AS nombre_usuario, 
             u.apellido AS apellido_usuario, 
             u.rol AS rol_usuario, 
             t.ci AS ci_transportista, 
             t.telefono AS telefono_transportista, 
             v.placa, 
             v.tipo AS tipo_vehiculo, 
             r.fecha_recogida, 
             r.hora_recogida, 
             r.hora_entrega,
             r.instrucciones_recogida, 
             r.instrucciones_entrega,
             c.tipo AS tipo_carga, 
             c.variedad, 
             c.cantidad, 
             c.empaquetado, 
             c.peso,
             tp.nombre AS tipo_transporte
      FROM Envios e
      LEFT JOIN Usuarios u ON e.id_usuario = u.id
      LEFT JOIN Transportistas t ON e.id_transportista = t.id
      LEFT JOIN Vehiculos v ON e.id_vehiculo = v.id
      LEFT JOIN RecogidaEntrega r ON e.id_recogida_entrega = r.id
      LEFT JOIN Carga c ON e.id_carga = c.id
      LEFT JOIN TipoTransporte tp ON e.id_tipo_transporte = tp.id
    `;

    if (usuario.rol !== 'admin') {
      query += ' WHERE e.id_usuario = @id_usuario';
      request.input('id_usuario', sql.Int, usuario.id);
    }

    const result = await request.query(query);
    res.json(result.recordset);
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

    const resultado = await pool.request()
      .input('id', sql.Int, envioId)
      .query(`
        SELECT e.*, 
               u.nombre AS nombre_usuario, u.apellido AS apellido_usuario, 
               ut.nombre AS nombre_transportista, ut.apellido AS apellido_transportista,
               t.ci AS ci_transportista, t.telefono AS telefono_transportista, 
               v.placa, v.tipo AS tipo_vehiculo, 
               tp.nombre AS tipo_transporte, tp.descripcion AS descripcion_transporte,
               r.fecha_recogida, r.hora_recogida, r.hora_entrega,
               r.instrucciones_recogida, r.instrucciones_entrega,
               c.tipo AS tipo_carga, c.variedad, c.cantidad, c.empaquetado, c.peso
        FROM Envios e
        LEFT JOIN Usuarios u ON e.id_usuario = u.id
        LEFT JOIN Transportistas t ON e.id_transportista = t.id
        LEFT JOIN Usuarios ut ON t.id_usuario = ut.id
        LEFT JOIN Vehiculos v ON e.id_vehiculo = v.id
        LEFT JOIN RecogidaEntrega r ON e.id_recogida_entrega = r.id
        LEFT JOIN Carga c ON e.id_carga = c.id
        LEFT JOIN TipoTransporte tp ON e.id_tipo_transporte = tp.id
        WHERE e.id = @id
      `);

    if (resultado.recordset.length === 0) {
      return res.status(404).json({ error: 'Envío no encontrado' });
    }

    const envio = resultado.recordset[0];

    if (req.usuario.rol !== 'admin' && envio.id_usuario !== req.usuario.id) {
      return res.status(403).json({ error: 'No tienes permiso para ver este envío' });
    }

    try {
      const ubicacion = await Direccion.findById(envio.id_ubicacion_mongo).lean();

      if (ubicacion) {
        envio.coordenadas_origen = ubicacion.coordenadasOrigen;
        envio.coordenadas_destino = ubicacion.coordenadasDestino;
        envio.nombre_origen = ubicacion.nombreOrigen;
        envio.nombre_destino = ubicacion.nombreDestino;
        envio.rutaGeoJSON = ubicacion.rutaGeoJSON;
      } else {
        envio.coordenadas_origen = null;
        envio.coordenadas_destino = null;
        envio.nombre_origen = "—";
        envio.nombre_destino = "—";
        envio.rutaGeoJSON = null;
      }
    } catch (mongoErr) {
      console.error("⚠️ Error consultando MongoDB:", mongoErr.message);
      envio.coordenadas_origen = null;
      envio.coordenadas_destino = null;
      envio.nombre_origen = "—";
      envio.nombre_destino = "—";
      envio.rutaGeoJSON = null;
    }

    res.json(envio);
  } catch (err) {
    console.error('❌ Error al obtener envío:', err);
    res.status(500).json({ error: 'Error al obtener el envío' });
  }
}



// 4.- Asignar transportista y vehículo (solo admin)
async function asignarTransportistaYVehiculo(req, res) {
  const id = parseInt(req.params.id);
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

    // ✅ Asignar transportista y vehículo al envío
    const result = await pool.request()
      .input('id', sql.Int, id)
      .input('id_transportista', sql.Int, id_transportista)
      .input('id_vehiculo', sql.Int, id_vehiculo)
      .input('estado', sql.NVarChar, 'Asignado')
      .query(`
        UPDATE Envios 
        SET id_transportista = @id_transportista, 
            id_vehiculo = @id_vehiculo, 
            estado = @estado
        WHERE id = @id
      `);

    if (result.rowsAffected[0] === 0) {
      return res.status(404).json({ error: 'Envío no encontrado' });
    }

    // ✅ Actualizar estado de transportista y vehículo a "No Disponible"
    await pool.request()
      .input('id_transportista', sql.Int, id_transportista)
      .query(`UPDATE Transportistas SET estado = 'No Disponible' WHERE id = @id_transportista`);

    await pool.request()
      .input('id_vehiculo', sql.Int, id_vehiculo)
      .query(`UPDATE Vehiculos SET estado = 'No Disponible' WHERE id = @id_vehiculo`);

    res.json({ mensaje: '✅ Envío asignado correctamente y recursos actualizados' });
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
    const resultado = await pool.request()
      .input('id_usuario', sql.Int, userId)
      .query(`
        SELECT e.*, 
               u.nombre AS nombre_usuario, 
               u.apellido AS apellido_usuario, 
               u.rol AS rol_usuario,  
               t.ci AS ci_transportista, 
               t.telefono AS telefono_transportista, 
               v.placa, v.tipo AS tipo_vehiculo, 
               r.fecha_recogida, r.hora_recogida, r.hora_entrega,
               r.instrucciones_recogida, r.instrucciones_entrega,
               c.tipo AS tipo_carga, c.variedad, c.cantidad, c.empaquetado, c.peso,
               tp.nombre AS tipo_transporte
        FROM Envios e
        LEFT JOIN Usuarios u ON e.id_usuario = u.id
        LEFT JOIN Transportistas t ON e.id_transportista = t.id
        LEFT JOIN Vehiculos v ON e.id_vehiculo = v.id
        LEFT JOIN RecogidaEntrega r ON e.id_recogida_entrega = r.id
        LEFT JOIN Carga c ON e.id_carga = c.id
        LEFT JOIN TipoTransporte tp ON e.id_tipo_transporte = tp.id
        WHERE e.id_usuario = @id_usuario
      `);

    const envios = resultado.recordset;

    // 🔁 Enriquecer con nombres desde MongoDB
    const enviosCompletos = await Promise.all(envios.map(async envio => {
      try {
        const ubicacion = await Direccion.findById(envio.id_ubicacion_mongo);
        if (ubicacion) {
          envio.nombre_origen = ubicacion.nombreOrigen || "—";
          envio.nombre_destino = ubicacion.nombreDestino || "—";
        }
      } catch (err) {
        console.warn("⚠️ Error buscando ubicación en Mongo:", err.message);
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
  const envioId = parseInt(req.params.id);
  const userId = req.usuario.id;
  const rol = req.usuario.rol;

  if (rol !== 'transportista') {
    return res.status(403).json({ error: 'Solo los transportistas pueden iniciar el viaje' });
  }

  try {
    const pool = await poolPromise;

    // Verificar si el envío existe y está asignado a este transportista
    const resultado = await pool.request()
      .input('id', sql.Int, envioId)
      .query(`SELECT * FROM Envios WHERE id = @id AND estado = 'Asignado'`);

    if (resultado.recordset.length === 0) {
      return res.status(404).json({ error: 'El envío no existe o no está en estado asignado' });
    }

    const envio = resultado.recordset[0];

    // Verificar transportista asignado
    const transportista = await pool.request()
      .input('id_usuario', sql.Int, userId)
      .query(`SELECT id FROM Transportistas WHERE id_usuario = @id_usuario`);

    if (transportista.recordset.length === 0) {
      return res.status(403).json({ error: 'No se encontró al transportista' });
    }

    const id_transportista = transportista.recordset[0].id;

    if (envio.id_transportista !== id_transportista) {
      return res.status(403).json({ error: 'No tienes acceso a este envío' });
    }

    // ✅ VALIDAR checklist antes de iniciar el viaje
    const checklistRes = await pool.request()
      .input('id_envio', sql.Int, envioId)
      .query(`SELECT id FROM ChecklistCondicionesTransporte WHERE id_envio = @id_envio`);

    if (checklistRes.recordset.length === 0) {
      return res.status(400).json({ error: 'Debes completar el checklist antes de iniciar el viaje' });
    }

    // ✅ Iniciar viaje
    await pool.request()
      .input('estado', sql.NVarChar, 'En curso')
      .input('fecha_inicio', sql.DateTime, new Date())
      .input('id', sql.Int, envioId)
      .query(`UPDATE Envios SET estado = @estado, fecha_inicio = @fecha_inicio WHERE id = @id`);

    await pool.request()
      .input('estado', sql.NVarChar, 'En ruta')
      .input('id', sql.Int, envio.id_transportista)
      .query(`UPDATE Transportistas SET estado = @estado WHERE id = @id`);

    await pool.request()
      .input('estado', sql.NVarChar, 'En ruta')
      .input('id', sql.Int, envio.id_vehiculo)
      .query(`UPDATE Vehiculos SET estado = @estado WHERE id = @id`);

    res.json({ mensaje: '✅ Viaje iniciado correctamente' });

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

    // 🔍 Obtener ID del transportista según el usuario logueado
    const resultTransportista = await pool.request()
      .input('id_usuario', sql.Int, id_usuario)
      .query('SELECT id FROM Transportistas WHERE id_usuario = @id_usuario');

    if (resultTransportista.recordset.length === 0) {
      return res.status(404).json({ error: 'No eres un transportista válido' });
    }

    const id_transportista = resultTransportista.recordset[0].id;

    // ✅ Buscar los envíos asignados a ese transportista
    const result = await pool.request()
      .input('id_transportista', sql.Int, id_transportista)
      .query(`
        SELECT e.*, 
               c.tipo AS tipo_carga, c.variedad, c.cantidad, c.empaquetado, c.peso,
               r.fecha_recogida, r.hora_recogida, r.hora_entrega,
               r.instrucciones_recogida, r.instrucciones_entrega,
               tp.nombre AS tipo_transporte
        FROM Envios e
        LEFT JOIN Carga c ON e.id_carga = c.id
        LEFT JOIN RecogidaEntrega r ON e.id_recogida_entrega = r.id
        LEFT JOIN TipoTransporte tp ON e.id_tipo_transporte = tp.id
        WHERE e.id_transportista = @id_transportista
      `);

    res.json(result.recordset);
  } catch (err) {
    console.error('❌ Error al obtener envíos del transportista:', err);
    res.status(500).json({ error: 'Error interno al obtener los envíos' });
  }
}

// 8.- Finalizar envío (transportista)
async function finalizarEnvio(req, res) {
  const envioId = parseInt(req.params.id);
  const id_usuario = req.usuario.id;

  if (isNaN(envioId)) return res.status(400).json({ error: 'ID inválido' });

  try {
    const pool = await poolPromise;

    // Obtener ID del transportista autenticado
    const transportistaRes = await pool.request()
      .input('id_usuario', sql.Int, id_usuario)
      .query(`SELECT id FROM Transportistas WHERE id_usuario = @id_usuario`);

    if (transportistaRes.recordset.length === 0) {
      return res.status(403).json({ error: 'No tienes permisos para esta acción' });
    }

    const id_transportista = transportistaRes.recordset[0].id;

    // Obtener envío
    const envioRes = await pool.request()
      .input('id', sql.Int, envioId)
      .query(`SELECT * FROM Envios WHERE id = @id`);

    const envio = envioRes.recordset[0];
    if (!envio) return res.status(404).json({ error: 'Envío no encontrado' });

    // Validar transportista asignado y estado
    if (envio.id_transportista !== id_transportista) {
      return res.status(403).json({ error: 'No tienes permiso para finalizar este envío' });
    }

    if (envio.estado !== 'En curso') {
      return res.status(400).json({ error: 'El envío no está en curso, no puede finalizarse' });
    }

    // Actualizar estado del envío
    await pool.request()
      .input('id', sql.Int, envioId)
      .input('fecha_entrega', sql.DateTime, new Date())
      .query(`
        UPDATE Envios 
        SET estado = 'Entregado', fecha_entrega = @fecha_entrega 
        WHERE id = @id
      `);

    // Liberar transportista y vehículo
    await pool.request()
      .input('id', sql.Int, envio.id_transportista)
      .query(`UPDATE Transportistas SET estado = 'Disponible' WHERE id = @id`);

    await pool.request()
      .input('id', sql.Int, envio.id_vehiculo)
      .query(`UPDATE Vehiculos SET estado = 'Disponible' WHERE id = @id`);

    res.json({ mensaje: '✅ Envío finalizado correctamente' });

  } catch (err) {
    console.error('❌ Error al finalizar envío:', err);
    res.status(500).json({ error: 'Error al finalizar el envío' });
  }
}

// 9.- Registrar checklist de condiciones antes de iniciar viaje
async function registrarChecklistCondiciones(req, res) {
  const id_envio = parseInt(req.params.id);
  const id_usuario = req.usuario.id;

  const checklist = req.body;

  if (isNaN(id_envio)) {
    return res.status(400).json({ error: 'ID de envío inválido' });
  }

  try {
    const pool = await poolPromise;

    // Verificar si el usuario es el transportista asignado a ese envío
    const validacion = await pool.request()
      .input('id_envio', sql.Int, id_envio)
      .query(`
        SELECT e.id_transportista, e.estado, t.id_usuario
        FROM Envios e
        INNER JOIN Transportistas t ON e.id_transportista = t.id
        WHERE e.id = @id_envio
      `);

    const datos = validacion.recordset[0];
    if (!datos) return res.status(404).json({ error: 'Envío no encontrado o sin transportista asignado' });

    if (datos.id_usuario !== id_usuario) {
      return res.status(403).json({ error: 'No tienes permiso para este envío' });
    }

    if (datos.estado !== 'Asignado') {
      return res.status(400).json({ error: 'El checklist solo se puede llenar si el envío está Asignado' });
    }

    // Verificar si ya existe un checklist para este envío
    const yaExiste = await pool.request()
      .input('id_envio', sql.Int, id_envio)
      .query('SELECT id FROM ChecklistCondicionesTransporte WHERE id_envio = @id_envio');

    if (yaExiste.recordset.length > 0) {
      return res.status(400).json({ error: 'Este checklist ya fue registrado' });
    }

    // Insertar checklist
    await pool.request()
      .input('id_envio', sql.Int, id_envio)
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
          id_envio, temperatura_controlada, embalaje_adecuado, carga_segura,
          vehiculo_limpio, documentos_presentes, ruta_conocida, combustible_completo,
          gps_operativo, comunicacion_funcional, estado_general_aceptable, observaciones
        )
        VALUES (
          @id_envio, @temperatura_controlada, @embalaje_adecuado, @carga_segura,
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
async function registrarChecklistIncidentes(req, res) {
  const id_envio = parseInt(req.params.id);
  const checklist = req.body;
  const id_usuario = req.usuario.id;

  if (isNaN(id_envio)) {
    return res.status(400).json({ error: 'ID inválido' });
  }

  try {
    const pool = await poolPromise;

    // Validar que el envío existe y está entregado
    const envioRes = await pool.request()
      .input('id', sql.Int, id_envio)
      .query(`SELECT * FROM Envios WHERE id = @id AND estado = 'Entregado'`);

    const envio = envioRes.recordset[0];
    if (!envio) return res.status(400).json({ error: 'El envío no está finalizado aún' });

    // Validar que el usuario sea el transportista asignado
    const transportistaRes = await pool.request()
      .input('id_usuario', sql.Int, id_usuario)
      .query('SELECT id FROM Transportistas WHERE id_usuario = @id_usuario');

    const id_transportista = transportistaRes.recordset[0]?.id;
    if (envio.id_transportista !== id_transportista) {
      return res.status(403).json({ error: 'No tienes acceso a este envío' });
    }

    // Validar si ya existe un checklist
    const existe = await pool.request()
      .input('id_envio', sql.Int, id_envio)
      .query('SELECT id FROM ChecklistIncidentesTransporte WHERE id_envio = @id_envio');

    if (existe.recordset.length > 0) {
      return res.status(400).json({ error: 'El checklist ya fue registrado' });
    }

    // Insertar checklist de incidentes
    await pool.request()
      .input('id_envio', sql.Int, id_envio)
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
          id_envio, retraso, problema_mecanico, accidente, perdida_carga,
          condiciones_climaticas_adversas, ruta_alternativa_usada,
          contacto_cliente_dificultoso, parada_imprevista, problemas_documentacion,
          otros_incidentes, descripcion_incidente
        )
        VALUES (
          @id_envio, @retraso, @problema_mecanico, @accidente, @perdida_carga,
          @condiciones_climaticas_adversas, @ruta_alternativa_usada,
          @contacto_cliente_dificultoso, @parada_imprevista, @problemas_documentacion,
          @otros_incidentes, @descripcion_incidente
        )
      `);

    res.status(201).json({ mensaje: '✅ Checklist de incidentes registrado correctamente' });

  } catch (err) {
    console.error('❌ Error al guardar checklist de incidentes:', err);
    res.status(500).json({ error: 'Error interno' });
  }
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
  registrarChecklistIncidentes
};
