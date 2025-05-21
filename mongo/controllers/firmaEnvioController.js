const FirmaEnvio = require('../models/firmaEnvio');

// POST /api/envios/firma/:id_asignacion
async function guardarFirmaEnvio(req, res) {
  const id_asignacion = parseInt(req.params.id_asignacion);
  const { imagenFirma } = req.body;

  if (isNaN(id_asignacion)) {
    return res.status(400).json({ error: 'ID de asignación inválido' });
  }

  if (!imagenFirma || typeof imagenFirma !== 'string') {
    return res.status(400).json({ error: 'Se requiere una imagen de firma válida (base64)' });
  }

  try {
    // Verificar si ya existe firma para esta asignación
    const firmaExistente = await FirmaEnvio.findOne({ id_asignacion });

    if (firmaExistente) {
      return res.status(400).json({ error: 'Ya existe una firma para esta asignación' });
    }

    // Guardar nueva firma
    const nuevaFirma = new FirmaEnvio({
      id_asignacion,
      imagenFirma
    });

    await nuevaFirma.save();

    res.status(201).json({
      mensaje: 'Firma guardada correctamente',
      id_asignacion
    });
  } catch (error) {
    console.error('Error al guardar firma:', error);
    res.status(500).json({ error: 'Error interno al guardar la firma' });
  }
}

module.exports = {
  guardarFirmaEnvio
};
