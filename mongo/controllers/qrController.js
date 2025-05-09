require('dotenv').config();

const QrToken = require('../models/qrToken');
const FirmaEnvio = require('../models/firmaEnvio');
const Direccion = require('../models/ubicacion');
const { sql, poolPromise } = require('../../config/sqlserver');
const qrcode = require('qrcode');

const FRONTEND_BASE_URL = process.env.FRONTEND_BASE_URL || 'https://orgtrackprueba.netlify.app';

// 1️⃣ Obtener QR existente (no generar)
async function obtenerQR(req, res) {
    const { id_asignacion } = req.params;

    try {
        // Buscar el QR en MongoDB
        const qrToken = await QrToken.findOne({ id_asignacion });

        if (!qrToken) {
            return res.status(404).json({ error: 'QR no encontrado para esta asignación' });
        }

        // Generar URL y QR
        const tokenUrl = `${FRONTEND_BASE_URL}/validar-qr/${qrToken.token}`;
        const qrCodeDataURL = await qrcode.toDataURL(tokenUrl);

        return res.status(200).json({
            mensaje: '✅ QR encontrado correctamente',
            id_asignacion: qrToken.id_asignacion,
            token: qrToken.token,
            qrCodeUrl: tokenUrl,
            qrCodeImage: qrCodeDataURL,
            usado: qrToken.usado,
            fecha_creacion: qrToken.fecha_creacion
        });

    } catch (error) {
        console.error('❌ Error al obtener QR:', error);
        return res.status(500).json({ error: 'Error interno al obtener QR' });
    }
}

// 2️⃣ Validar QR y devolver detalles de la partición
async function validarQR(req, res) {
    const { token } = req.params;
    const id_usuario_cliente = req.usuario.id;

    try {
        // Buscar el QR en MongoDB usando el token
        const qrToken = await QrToken.findOne({ token, usado: false });

        if (!qrToken) {
            return res.status(404).json({ error: 'QR no encontrado o ya fue usado' });
        }

        const id_asignacion = qrToken.id_asignacion;

        // Obtener detalles de la partición desde SQL Server
        const pool = await poolPromise;
        const resultado = await pool.request()
            .input('id_asignacion', sql.Int, id_asignacion)
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
                WHERE am.id = @id_asignacion
            `);

        const detalles = resultado.recordset[0];

        if (!detalles) {
            return res.status(404).json({ error: 'Partición no encontrada' });
        }

        // Obtener ubicación desde MongoDB
        const ubicacion = await Direccion.findById(detalles.id_ubicacion_mongo).lean();

        // Verificar si ya existe firma para esta asignación
        const firmaExistente = await FirmaEnvio.findOne({ id_asignacion });

        return res.status(200).json({
            particion: {
                ...detalles,
                nombre_origen: ubicacion?.nombreOrigen || '—',
                nombre_destino: ubicacion?.nombreDestino || '—',
                coordenadas_origen: ubicacion?.coordenadasOrigen || [],
                coordenadas_destino: ubicacion?.coordenadasDestino || [],
                firma_existente: !!firmaExistente
            }
        });

    } catch (error) {
        console.error('❌ Error al validar QR:', error);
        return res.status(500).json({ error: 'Error interno al validar QR' });
    }
}

// 3️⃣ Marcar QR como usado (cuando se firma)
async function marcarQRUsado(req, res) {
    const { token } = req.params;

    try {
        // Marcar el QR como usado en MongoDB
        const qrToken = await QrToken.findOneAndUpdate(
            { token },
            { usado: true },
            { new: true }
        );

        if (!qrToken) {
            return res.status(404).json({ error: 'QR no encontrado o ya fue usado' });
        }

        return res.status(200).json({
            mensaje: '✅ QR marcado como usado',
            id_asignacion: qrToken.id_asignacion,
            usado: qrToken.usado
        });

    } catch (error) {
        console.error('❌ Error al marcar QR como usado:', error);
        return res.status(500).json({ error: 'Error interno al marcar QR como usado' });
    }
}

// Exportar funciones del controlador
module.exports = {
    obtenerQR,
    validarQR,
    marcarQRUsado
};
