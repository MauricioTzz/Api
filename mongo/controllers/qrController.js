// ✅ Importar dependencias necesarias
require('dotenv').config();
const QrToken = require('../models/qrToken');
const { sql, poolPromise } = require('../config/sqlserver');

// ✅ Endpoint para obtener el QR de una asignación, solo para el transportista correcto
async function obtenerQR(req, res) {
    const { id_asignacion } = req.params;
    const userId = req.usuario.id;
    const rol = req.usuario.rol;

    try {
        // 🔐 Verificar que el usuario sea un transportista
        if (rol !== 'transportista') {
            return res.status(403).json({ error: 'Solo los transportistas pueden ver los QR' });
        }

        // 🔎 Buscar el transportista relacionado con el usuario autenticado
        const pool = await poolPromise;
        const transportistaRes = await pool.request()
            .input('id_usuario', sql.Int, userId)
            .query('SELECT id FROM Transportistas WHERE id_usuario = @id_usuario');

        if (transportistaRes.recordset.length === 0) {
            return res.status(403).json({ error: 'No se encontró al transportista' });
        }

        const id_transportista = transportistaRes.recordset[0].id;

        // 🔗 Verificar que el transportista sea el asignado a esta partición
        const asignacionRes = await pool.request()
            .input('id_asignacion', sql.Int, id_asignacion)
            .input('id_transportista', sql.Int, id_transportista)
            .query(`
                SELECT * FROM AsignacionMultiple 
                WHERE id = @id_asignacion AND id_transportista = @id_transportista
            `);

        if (asignacionRes.recordset.length === 0) {
            return res.status(403).json({ error: 'No tienes acceso a esta asignación' });
        }

        // 🔎 Buscar el QR en MongoDB
        const qrToken = await QrToken.findOne({ id_asignacion });

        // 📌 Si no se encuentra, devolver error
        if (!qrToken) {
            return res.status(404).json({ error: 'QR no encontrado para esta asignación' });
        }

        // ✅ Responder con los datos del QR
        return res.status(200).json({
            mensaje: '✅ QR encontrado correctamente',
            id_asignacion: qrToken.id_asignacion,
            token: qrToken.token,
            imagenQR: qrToken.imagenQR,
            usado: qrToken.usado,
            fecha_creacion: qrToken.fecha_creacion,
            fecha_expiracion: qrToken.fecha_expiracion
        });

    } catch (error) {
        console.error('❌ Error al obtener QR:', error);
        return res.status(500).json({ error: 'Error interno al obtener QR' });
    }
}

// ✅ Exportar la función
module.exports = { obtenerQR };
