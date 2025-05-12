const express = require('express');
const router = express.Router();
const { verificarToken, soloAdmin } = require('../../auth/jwt'); // <-- esta línea es clave
const controller = require('../controllers/enviosController');



// ✅ Primero las rutas específicas
router.get('/mis-envios', verificarToken, controller.obtenerMisEnvios);
router.get('/mis-envios-transportista', verificarToken, controller.obtenerEnviosAsignadosTransportista);
router.post('/', verificarToken, controller.crearEnvioCompleto);
router.put('/asignar/:id', verificarToken, soloAdmin, controller.asignarTransportistaYVehiculo);
router.put('/asignar-particion/:id_asignacion', verificarToken, soloAdmin, controller.asignarTransportistaYVehiculoAParticion);
router.put('/iniciar/:id', verificarToken, controller.iniciarViaje);
router.put('/finalizar/:id', verificarToken, controller.finalizarEnvio);
router.put('/:id/estado-global', verificarToken, soloAdmin, controller.actualizarEstadoGlobalEnvio);
router.get('/documento/:id_envio', verificarToken, controller.generarDocumentoEnvio);
router.get('/documento-particion/:id_asignacion', verificarToken, controller.generarDocumentoParticion);
router.get('/', verificarToken, soloAdmin, controller.obtenerTodos);
router.post('/:id/checklist-condiciones', verificarToken, controller.registrarChecklistCondiciones);
router.post('/:id/checklist-incidentes', verificarToken, controller.registrarChecklistIncidentes);
router.get('/particiones-en-curso', verificarToken, controller.obtenerParticionesEnCursoCliente);


// ⚠️ Esta debe ir al final
router.get('/:id', verificarToken, controller.obtenerPorId);


module.exports = router;
