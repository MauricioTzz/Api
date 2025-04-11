const sql = require('mssql');

const config = {
  user: 'SebastianRE_SQLLogin_1',
  password: 'f1buyz6wyk',
  server: 'prueba_proyect.mssql.somee.com',
  database: 'prueba_proyect',
  options: {
    encrypt: true,
    trustServerCertificate: true
  }
};

const poolPromise = new sql.ConnectionPool(config)
  .connect()
  .then(pool => {
    console.log('Conectado a SQL Server');
    return pool;
  })
  .catch(err => {
    console.error('Error al conectar a SQL Server:', err);
  });

module.exports = {
  sql, poolPromise
};
