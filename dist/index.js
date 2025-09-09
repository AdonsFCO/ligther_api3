import express from 'express';
import { createClient } from 'redis';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
// Configuración inicial
dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.SERVER_PORT || 3000;
// Configurar Redis
const redis = createClient({
    url: process.env.REDIS_URL,
    socket: {
        host: process.env.REDIS_HOST,
        port: parseInt(process.env.REDIS_PORT || '19940')
    },
    username: process.env.REDIS_USERNAME,
    password: process.env.REDIS_PASSWORD
});
// Manejar errores de Redis
redis.on('error', (err) => console.log('Redis Client Error:', err));
redis.on('connect', () => console.log('✅ Conectado a Redis'));
redis.on('ready', () => console.log('✅ Redis listo'));
// Conectar a Redis
async function connectRedis() {
    try {
        await redis.connect();
        console.log('🚀 Conectado a Redis Cloud exitosamente');
    }
    catch (error) {
        console.error('❌ Error conectando a Redis:', error);
    }
}
// Middleware
app.use(express.json());
// Endpoint: Health Check
app.get('/health', async (req, res) => {
    try {
        const redisStatus = redis.isReady ? 'connected' : 'disconnected';
        res.json({
            status: 'healthy',
            timestamp: new Date().toISOString(),
            redis: redisStatus,
            uptime: process.uptime()
        });
    }
    catch (error) {
        res.status(500).json({ error: 'Health check failed' });
    }
});
// Endpoint: Heartbeat
app.post('/api/heartbeat', async (req, res) => {
    try {
        const { clientId, timestamp, bootTime, isReboot, isFirstRun, hostname } = req.body;
        if (!clientId) {
            return res.status(400).json({ error: 'clientId is required' });
        }
        console.log(`💓 Heartbeat recibido de: ${clientId}`);
        const now = new Date();
        const clientKey = `client:${clientId}`;
        // Obtener cliente existente
        const existingClient = await redis.hGetAll(clientKey);
        let shouldCreateRebootEvent = false;
        // Detectar reinicio real
        if (existingClient && existingClient.bootTime && bootTime) {
            const existingBootTime = new Date(existingClient.bootTime);
            const newBootTime = new Date(bootTime);
            if (existingBootTime.getTime() !== newBootTime.getTime() && !isFirstRun) {
                shouldCreateRebootEvent = true;
                console.log(`🔌 REINICIO DETECTADO: ${clientId}`);
            }
        }
        // Crear evento de reinicio si es necesario
        if (shouldCreateRebootEvent) {
            const rebootEvent = {
                id: `event_${Date.now()}`,
                type: 'reboot',
                timestamp: now.toISOString(),
                clientId,
                hostname,
                details: `Reinicio del servidor - ${hostname || clientId}`
            };
            await redis.lPush('events', JSON.stringify(rebootEvent));
            await redis.lTrim('events', 0, 999);
        }
        // Actualizar cliente
        await redis.hSet(clientKey, {
            lastSeen: now.toISOString(),
            bootTime: bootTime || now.toISOString(),
            status: 'connected',
            hostname: hostname || 'unknown'
        });
        await redis.expire(clientKey, 2592000); // 30 días
        res.json({
            status: 'ok',
            received: timestamp,
            message: 'Heartbeat processed successfully',
            isReboot: shouldCreateRebootEvent
        });
    }
    catch (error) {
        console.error('Error en heartbeat:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Endpoint: Obtener estado del sistema
app.get('/api/status', async (req, res) => {
    try {
        // Obtener todos los clientes
        const clientKeys = await redis.keys('client:*');
        const clients = {};
        for (const key of clientKeys) {
            const clientData = await redis.hGetAll(key);
            clients[key.replace('client:', '')] = clientData;
        }
        // Obtener eventos
        const eventsData = await redis.lRange('events', 0, -1);
        const events = eventsData.map((event) => JSON.parse(event));
        res.json({ events, clients });
    }
    catch (error) {
        console.error('Error getting status:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});
// Dashboard principal
app.get('/', async (req, res) => {
    try {
        const status = await fetch(`${req.protocol}://${req.get('host')}/api/status`).then(r => r.json());
        const totalClients = Object.keys(status.clients || {}).length;
        const activeClients = Object.values(status.clients || {}).filter((client) => client.status === 'connected').length;
        const outages = status.events?.filter((event) => event.type === 'reboot').length || 0;
        res.type('html').send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>⚡ Monitor de Apagones</title>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <style>
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
            color: #e2e8f0;
            min-height: 100vh;
          }
          .header {
            text-align: center;
            margin-bottom: 40px;
            padding: 30px;
            background: rgba(30, 41, 59, 0.8);
            border-radius: 15px;
            backdrop-filter: blur(10px);
          }
          .header h1 {
            margin: 0;
            font-size: 2.5em;
            color: #60a5fa;
          }
          .stats-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
            gap: 20px;
            margin-bottom: 30px;
          }
          .stat-card {
            background: rgba(30, 41, 59, 0.8);
            padding: 25px;
            border-radius: 12px;
            text-align: center;
            backdrop-filter: blur(10px);
            border: 1px solid rgba(255, 255, 255, 0.1);
          }
          .stat-number {
            font-size: 2.5em;
            font-weight: bold;
            margin: 10px 0;
          }
          .clients-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
            gap: 15px;
            margin-bottom: 30px;
          }
          .client-card {
            background: rgba(30, 41, 59, 0.8);
            padding: 20px;
            border-radius: 12px;
            border-left: 4px solid;
            backdrop-filter: blur(10px);
          }
          .client-connected {
            border-left-color: #22c55e;
          }
          .client-disconnected {
            border-left-color: #ef4444;
          }
          .events-list {
            background: rgba(30, 41, 59, 0.8);
            padding: 20px;
            border-radius: 12px;
            margin-bottom: 30px;
            backdrop-filter: blur(10px);
          }
          .event-item {
            padding: 15px;
            margin: 10px 0;
            background: rgba(51, 65, 85, 0.6);
            border-radius: 8px;
            border-left: 4px solid;
          }
          .event-reboot {
            border-left-color: #ef4444;
          }
          .event-reconnection {
            border-left-color: #22c55e;
          }
          .event-disconnection {
            border-left-color: #f59e0b;
          }
          .last-update {
            text-align: center;
            color: #94a3b8;
            margin-top: 30px;
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>⚡ Monitor de Apagones Domésticos</h1>
          <p>Sistema de monitoreo en tiempo real</p>
        </div>

        <div class="stats-grid">
          <div class="stat-card">
            <h3>Total de Clientes</h3>
            <div class="stat-number">${totalClients}</div>
            <p>Dispositivos monitoreados</p>
          </div>
          <div class="stat-card">
            <h3>Clientes Activos</h3>
            <div class="stat-number" style="color: #22c55e;">${activeClients}</div>
            <p>Conectados ahora</p>
          </div>
          <div class="stat-card">
            <h3>Apagones Detectados</h3>
            <div class="stat-number" style="color: #ef4444;">${outages}</div>
            <p>Reinicios del sistema</p>
          </div>
          <div class="stat-card">
            <h3>Eventos Totales</h3>
            <div class="stat-number" style="color: #60a5fa;">${status.events?.length || 0}</div>
            <p>Registros históricos</p>
          </div>
        </div>

        <div class="clients-grid">
          ${Object.entries(status.clients || {}).map(([clientId, client]) => `
            <div class="client-card ${client.status === 'connected' ? 'client-connected' : 'client-disconnected'}">
              <h3>${client.hostname || clientId}</h3>
              <p>Estado: <strong style="color: ${client.status === 'connected' ? '#22c55e' : '#ef4444'}">
                ${client.status === 'connected' ? '🟢 Conectado' : '🔴 Desconectado'}
              </strong></p>
              <p>Última vez: ${new Date(client.lastSeen).toLocaleString()}</p>
              <p>Boot Time: ${new Date(client.bootTime).toLocaleString()}</p>
            </div>
          `).join('')}
        </div>

        <div class="events-list">
          <h2>📋 Últimos Eventos</h2>
          ${(status.events || []).slice(-10).reverse().map((event) => `
            <div class="event-item event-${event.type}">
              <strong>${new Date(event.timestamp).toLocaleString()}</strong>
              <br>
              <span style="text-transform: uppercase; font-weight: bold;">${event.type}</span>
              <br>
              ${event.details}
              ${event.duration ? `<br>Duración: ${event.duration} segundos` : ''}
            </div>
          `).join('') || '<p>No hay eventos registrados</p>'}
        </div>

        <div class="last-update">
          <p>Última actualización: ${new Date().toLocaleString()}</p>
          <p>Actualizando automáticamente cada 30 segundos...</p>
        </div>

        <script>
          // Auto-refresh cada 30 segundos
          setTimeout(() => {
            location.reload();
          }, 30000);
        </script>
      </body>
      </html>
    `);
    }
    catch (error) {
        res.send(`
      <!DOCTYPE html>
      <html>
      <head><title>Monitor de Apagones</title></head>
      <body>
        <h1>⚡ Monitor de Apagones</h1>
        <p>Error cargando el dashboard. Intenta recargar la página.</p>
      </body>
      </html>
    `);
    }
});
// Iniciar servidor
async function startServer() {
    try {
        await connectRedis();
        app.listen(PORT, () => {
            console.log(`🚀 Servidor ejecutándose en puerto ${PORT}`);
            console.log(`📊 Dashboard: http://localhost:${PORT}`);
            console.log(`❤️  Health Check: http://localhost:${PORT}/health`);
        });
    }
    catch (error) {
        console.error('Error iniciando servidor:', error);
        process.exit(1);
    }
}
// Manejar cierre graceful
process.on('SIGINT', async () => {
    console.log('\n🛑 Cerrando servidor...');
    await redis.quit();
    process.exit(0);
});
startServer();
export default app;
