import express, { Request, Response } from 'express';
import { Redis } from '@upstash/redis'; // ✅ Cambiado a @upstash/redis
import dotenv from 'dotenv';

// Cargar variables de entorno
dotenv.config();

const app = express();

// Configurar Redis con @upstash/redis ✅
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.REDIS_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.REDIS_PASSWORD,
});
interface PowerEvent {
  id: string;
  type: 'outage' | 'reconnection' | 'reboot' | 'disconnection';
  timestamp: string;
  duration?: number;
  clientId: string;
  hostname?: string;
  details: string;
}

interface ClientInfo {
  lastSeen: string;
  bootTime: string;
  status: 'connected' | 'disconnected';
  hostname?: string;
}

// Middleware
app.use(express.json());

// ✅ ENDPOINT HEARTBEAT CON REDIS
app.post('/api/heartbeat', async (req: Request, res: Response) => {
  try {
    const { clientId, timestamp, bootTime, isReboot, isFirstRun, hostname } = req.body;
    const now = new Date();

    if (!clientId) {
      return res.status(400).json({ error: 'clientId is required' });
    }

    console.log(`💓 Heartbeat recibido de: ${clientId}`);

    // Obtener datos existentes de Redis
    const existingClient = await redis.hgetall(`client:${clientId}`);
    const events = await redis.lrange('events', 0, -1);

    let shouldCreateRebootEvent = false;

    // ✅ Lógica CORREGIDA para detectar reinicios
    if (existingClient && existingClient.bootTime) {
      const existingBootTime = new Date(existingClient.bootTime as string);
      const newBootTime = new Date(bootTime);
      
      // Solo es reinicio si el bootTime es diferente Y no es el primer run
      if (existingBootTime.getTime() !== newBootTime.getTime() && !isFirstRun) {
        shouldCreateRebootEvent = true;
        console.log(`🔌 REINICIO REAL DETECTADO: ${clientId}`);
      }
    }

    // Crear evento de reinicio si es necesario
    if (shouldCreateRebootEvent) {
      const rebootEvent: PowerEvent = {
        id: `event_${Date.now()}`,
        type: 'reboot',
        timestamp: now.toISOString(),
        clientId,
        hostname,
        details: `Reinicio del servidor - ${hostname || clientId}`
      };
      
      await redis.lpush('events', JSON.stringify(rebootEvent));
      await redis.ltrim('events', 0, 999); // Mantener solo últimos 1000 eventos
    }

    // Actualizar cliente en Redis
    await redis.hset(`client:${clientId}`, {
      lastSeen: now.toISOString(),
      bootTime: bootTime || now.toISOString(),
      status: 'connected',
      hostname: hostname || 'unknown'
    });

    // Set expiration para clientes (30 días)
    await redis.expire(`client:${clientId}`, 2592000);

    res.json({ 
      status: 'ok', 
      received: timestamp,
      message: 'Heartbeat processed successfully',
      isReboot: shouldCreateRebootEvent
    });

  } catch (error) {
    console.error('Error en heartbeat:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ ENDPOINT STATUS CON REDIS
app.get('/api/status', async (req: Request, res: Response) => {
  try {
    // Obtener todos los clientes
    const clientKeys = await redis.keys('client:*');
    const clients: { [key: string]: ClientInfo } = {};
    
    for (const key of clientKeys) {
      const clientData = await redis.hgetall(key);
      clients[key.replace('client:', '')] = clientData as unknown as ClientInfo;
    }

    // Obtener eventos
    const eventsData = await redis.lrange('events', 0, -1);
    const events: PowerEvent[] = eventsData.map((event: string) => JSON.parse(event));

    res.json({ events, clients });

  } catch (error) {
    console.error('Error getting status:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ DASHBOARD
app.get('/', async (req: Request, res: Response) => {
  try {
    const status = await fetch(`${req.protocol}://${req.get('host')}/api/status`).then(r => r.json());
    
    res.type('html').send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Monitor de Apagones</title>
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
      </head>
      <body>
        <h1>⚡ Monitor de Apagones</h1>
        <p>Clientes: ${Object.keys(status.clients || {}).length}</p>
        <p>Eventos: ${status.events?.length || 0}</p>
      </body>
      </html>
    `);
  } catch (error) {
    res.send('Error loading dashboard');
  }
});

export default app;