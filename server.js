const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const authRoutes = require('./auth/authRoutes');
const conectarMongo = require('./config/mongo');
const testRoutes = require('./routes_generales/testRoutes');
const rutasTransportistas = require('./sql/routes/transportistasRoutes');
const rutasUsuarios = require('./sql/routes/usuariosRoutes');
const rutasVehiculos = require('./sql/routes/vehiculosRoutes');
const rutasTipoTransporte = require('./sql/routes/tipoTransporteRoutes');
const rutasEnvios = require('./sql/routes/enviosRoutes');
const rutasRecogidaEntrega = require('./sql/routes/recogidaEntregaRoutes');
const rutasUbicaciones = require('./mongo/routes/ubicaciones');
const rutasFirmasEnvio = require('./mongo/routes/firmaEnvioRoutes');

const rutasQrTokens = require('./mongo/routes/qrRoutes');

const rutasEnviosAdmin = require('./sql/routes/enviosAdminRoutes');


conectarMongo();
const { poolPromise } = require('./config/sqlserver');

const app = express();
const PORT = process.env.PORT || 3000; // importante para Render

app.use(cors());
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));

// Rutas API
app.use('/api/auth', authRoutes);
app.use('/api/vehiculos', rutasVehiculos);
app.use('/api/recogida-entrega', rutasRecogidaEntrega);
app.use('/api/tipos-transporte', rutasTipoTransporte);
app.use('/api/usuarios', rutasUsuarios);
app.use('/api/transportistas', rutasTransportistas);
app.use('/api/envios', rutasEnvios);
app.use('/api/test', testRoutes);
app.use('/api/ubicaciones', rutasUbicaciones);
app.use('/api/qr', rutasQrTokens);

app.use('/api/envios/admin', rutasEnviosAdmin);
app.use('/api/envios', rutasFirmasEnvio);


app.post('/api/auth/test', (req, res) => {
  res.json({ mensaje: 'Test OK' });
});

app.get('/api/test-sql', async (req, res) => {
  try {
    const pool = await poolPromise;
    const result = await pool.request().query('SELECT TOP 1 * FROM Usuarios');
    res.json({ message: '✅ SQL Server conectado', resultado: result.recordset });
  } catch (err) {
    console.error('❌ Error en consulta SQL:', err);
    res.status(500).json({ error: 'No se pudo conectar a SQL Server' });
  }
});

app.get('/', (req, res) => {
  res.send('Servidor Express activo');
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en el puerto ${PORT}`);
});
