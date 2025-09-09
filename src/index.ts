import express, { Request, Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { writeFile, readFile } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const DATA_FILE = 'power-data.json';

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

interface MonitorData {
  events: PowerEvent[];
  clients: { [key: string]: ClientInfo };
}

let monitorData: MonitorData = {
  events: [],
  clients: {}
};

// Cargar y guardar datos
async function loadData() {
  try {
    const data = await readFile(DATA_FILE, 'utf8');
    monitorData = JSON.parse(data);
    console.log('Datos cargados correctamente');
  } catch (error) {
    console.log('Creando nuevo archivo de datos');
    await saveData();
  }
}

async function saveData() {
  try {
    await writeFile(DATA_FILE, JSON.stringify(monitorData, null, 2));
  } catch (error) {
    console.error('Error guardando datos:', error);
  }
}

// Verificar clientes desconectados
function checkDisconnectedClients() {
  const now = new Date();
  const FIVE_MINUTES = 5 * 60 * 1000;

  Object.entries(monitorData.clients).forEach(([clientId, client]) => {
    if (client.status === 'connected') {
      const lastSeen = new Date(client.lastSeen);
      if (now.getTime() - lastSeen.getTime() > FIVE_MINUTES) {
        client.status = 'disconnected';
        
        const event: PowerEvent = {
          id: `event_${Date.now()}`,
          type: 'disconnection',
          timestamp: now.toISOString(),
          clientId: clientId,
          hostname: client.hostname,
          details: `Cliente desconectado - ${client.hostname || clientId}`
        };
        monitorData.events.push(event);
        console.log(`⚠️ Cliente desconectado: ${clientId}`);
      }
    }
  });
}

// Middleware
app.use(express.json());

// ✅ ENDPOINT HEARTBEAT CORREGIDO (POST)
app.post('/api/heartbeat', async (req: Request, res: Response) => {
  try {
    const { clientId, timestamp, bootTime, isReboot, isFirstRun, hostname } = req.body;
    const now = new Date();

    if (!clientId) {
      return res.status(400).json({ error: 'clientId is required' });
    }

    console.log(`💓 Heartbeat recibido de: ${clientId}`);

    const clientKey = clientId as string;

    // Verificar reinicio
    if (isReboot && monitorData.clients[clientKey]) {
      const event: PowerEvent = {
        id: `event_${Date.now()}`,
        type: 'reboot',
        timestamp: now.toISOString(),
        clientId: clientKey,
        hostname: hostname,
        details: `Reinicio del servidor - ${hostname || clientKey}`
      };
      monitorData.events.push(event);
      console.log(`🔌 Reinicio detectado: ${clientKey}`);
    }

    // Verificar reconexión
    const existingClient = monitorData.clients[clientKey];
    if (existingClient && existingClient.status === 'disconnected') {
      const lastSeen = new Date(existingClient.lastSeen);
      const downtime = Math.floor((now.getTime() - lastSeen.getTime()) / 1000);
      
      const event: PowerEvent = {
        id: `event_${Date.now()}`,
        type: 'reconnection',
        timestamp: now.toISOString(),
        duration: downtime,
        clientId: clientKey,
        hostname: hostname,
        details: `Reconexión después de ${downtime} segundos - ${hostname || clientKey}`
      };
      monitorData.events.push(event);
      console.log(`✅ Reconexión: ${clientKey} después de ${downtime}s`);
    }

    // Actualizar cliente
    monitorData.clients[clientKey] = {
      lastSeen: now.toISOString(),
      bootTime: bootTime || now.toISOString(),
      status: 'connected',
      hostname: hostname
    };

    await saveData();
    
    res.json({ 
      status: 'ok', 
      received: timestamp,
      message: 'Heartbeat processed successfully'
    });

  } catch (error) {
    console.error('Error en heartbeat:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ✅ ENDPOINT STATUS (GET)
app.get('/api/status', (req: Request, res: Response) => {
  res.json(monitorData);
});

// ✅ ENDPOINT PRINCIPAL - DASHBOARD (GET)
app.get('/', (req: Request, res: Response) => {
  const now = new Date();
  const activeClients = Object.values(monitorData.clients).filter(client => 
    client.status === 'connected'
  ).length;

  const totalClients = Object.keys(monitorData.clients).length;
  const outages = monitorData.events.filter(e => e.type === 'reboot').length;
  const disconnections = monitorData.events.filter(e => e.type === 'disconnection').length;

  res.type('html').send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Monitor de Apagones</title>
      <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
      <style>
        body { font-family: Arial, sans-serif; margin: 20px; background: #0f172a; color: white; }
        .dashboard { max-width: 1200px; margin: 0 auto; }
        .card { background: #1e293b; padding: 20px; margin: 10px; border-radius: 8px; }
        .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
        .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 15px; margin-bottom: 20px; }
        .stat { text-align: center; padding: 15px; background: #334155; border-radius: 8px; }
        .stat-number { font-size: 24px; font-weight: bold; }
        .outage { color: #ef4444; }
        .reconnection { color: #22c55e; }
        .disconnection { color: #f59e0b; }
        .event { padding: 10px; margin: 5px 0; background: #334155; border-radius: 5px; }
      </style>
    </head>
    <body>
      <div class="dashboard">
        <h1>⚡ Monitor de Apagones Domésticos</h1>
        
        <div class="stats">
          <div class="stat">
            <div class="stat-number">${totalClients}</div>
            <div>Clientes Totales</div>
          </div>
          <div class="stat">
            <div class="stat-number">${activeClients}</div>
            <div>Clientes Activos</div>
          </div>
          <div class="stat">
            <div class="stat-number outage">${outages}</div>
            <div>Apagones</div>
          </div>
          <div class="stat">
            <div class="stat-number disconnection">${disconnections}</div>
            <div>Desconexiones</div>
          </div>
        </div>

        <div class="grid">
          <div class="card">
            <h2>📊 Estadísticas de Eventos</h2>
            <canvas id="eventChart" width="400" height="200"></canvas>
          </div>

          <div class="card">
            <h2>📋 Últimos Eventos</h2>
            <div style="max-height: 300px; overflow-y: auto;">
              ${monitorData.events.slice(-10).reverse().map(event => `
                <div class="event">
                  <div><strong>${new Date(event.timestamp).toLocaleString()}</strong></div>
                  <div class="${event.type}">${event.type.toUpperCase()}</div>
                  <div>${event.details}</div>
                </div>
              `).join('') || '<p>No hay eventos registrados</p>'}
            </div>
          </div>
        </div>

        <div class="card">
          <h2>🖥️ Clientes Conectados</h2>
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 10px;">
            ${Object.entries(monitorData.clients).map(([clientId, client]) => `
              <div style="background: ${client.status === 'connected' ? '#22c55e20' : '#ef444420'}; 
                         border: 2px solid ${client.status === 'connected' ? '#22c55e' : '#ef4444'};
                         padding: 15px; border-radius: 8px;">
                <div><strong>${client.hostname || clientId}</strong></div>
                <div>Estado: <span style="color: ${client.status === 'connected' ? '#22c55e' : '#ef4444'}">
                  ${client.status === 'connected' ? '🟢 Conectado' : '🔴 Desconectado'}
                </span></div>
                <div>Última vez: ${new Date(client.lastSeen).toLocaleString()}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <script>
        const eventData = {
          reboot: ${monitorData.events.filter(e => e.type === 'reboot').length},
          reconnection: ${monitorData.events.filter(e => e.type === 'reconnection').length},
          disconnection: ${monitorData.events.filter(e => e.type === 'disconnection').length}
        };

        new Chart(document.getElementById('eventChart'), {
          type: 'doughnut',
          data: {
            labels: ['Apagones', 'Reconexiones', 'Desconexiones'],
            datasets: [{
              data: [eventData.reboot, eventData.reconnection, eventData.disconnection],
              backgroundColor: ['#ef4444', '#22c55e', '#f59e0b']
            }]
          }
        });

        setTimeout(() => location.reload(), 30000);
      </script>
    </body>
    </html>
  `);
});

// ✅ HEALTH CHECK (GET)
app.get('/health', (req: Request, res: Response) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    clients: Object.keys(monitorData.clients).length,
    events: monitorData.events.length
  });
});

// Inicializar
loadData().then(() => {
  console.log('Monitor de apagones iniciado');
  // Verificar clientes desconectados cada minuto
  setInterval(checkDisconnectedClients, 60000);
});

export default app;