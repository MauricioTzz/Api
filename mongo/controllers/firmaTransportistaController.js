// controllers/firmaTransportistaController.js
const FirmaTransportista = require('../models/firmaTransportista');

async function guardarFirmaTransportista(req, res) {
  const id_asignacion = parseInt(req.params.id_asignacion);
  const { imagenFirma } = req.body;

  if (isNaN(id_asignacion)) {
    return res.status(400).json({ error: 'ID de asignación inválido' });
  }

  if (!imagenFirma || typeof imagenFirma !== 'string') {
    return res.status(400).json({ error: 'Se requiere una imagen de firma válida (base64)' });
  }

  try {
    const firmaExistente = await FirmaTransportista.findOne({ id_asignacion });
    if (firmaExistente) {
      return res.status(400).json({ error: 'Ya existe una firma del transportista para esta asignación' });
    }

    const nuevaFirma = new FirmaTransportista({
      id_asignacion,
      imagenFirma
    });

    await nuevaFirma.save();
    res.status(201).json({ mensaje: 'Firma del transportista guardada correctamente' });
  } catch (err) {
    console.error('Error al guardar firma del transportista:', err);
    res.status(500).json({ error: 'Error interno al guardar la firma' });
  }
}

async function obtenerFirmaPorAsignacion(req, res) {
  const id_asignacion = parseInt(req.params.id_asignacion);

  if (isNaN(id_asignacion)) {
    return res.status(400).json({ error: 'ID de asignación inválido' });
  }

  try {
    const firma = await FirmaTransportista.findOne({ id_asignacion });
    if (!firma) {
      return res.status(404).json({ error: 'No se encontró una firma para esta asignación' });
    }

    res.status(200).json(firma);
  } catch (err) {
    console.error('Error al obtener firma del transportista:', err);
    res.status(500).json({ error: 'Error interno al obtener la firma' });
  }
}


module.exports = {
  guardarFirmaTransportista,
  obtenerFirmaPorAsignacion
};
