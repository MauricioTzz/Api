const express = require('express');
const router = express.Router();
const fetch = require('node-fetch'); // Asegúrate de instalarlo si estás en Node <18

router.post('/obtener-ruta', async (req, res) => {
  try {
    const response = await fetch('https://api.openrouteservice.org/v2/directions/driving-car/geojson', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': '5b3ce3597851110001cf6248dbff311ed4d34185911c2eb9e6c50080' // tu key real
      },
      body: JSON.stringify(req.body)
    });

    const data = await response.json();
    res.json(data);
  } catch (error) {
    console.error('❌ Error en ruta API OpenRoute:', error);
    res.status(500).json({ error: 'No se pudo obtener la ruta' });
  }
});

module.exports = router;
