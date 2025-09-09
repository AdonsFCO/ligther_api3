import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { writeFile, readFile } from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const HEARTBEAT_FILE = 'heartbeats.json';

// Interfaces para TypeScript
interface ClientData {
  lastHeartbeat: string;
  ip: string | undefined;
  userAgent: string | undefined;
  totalHeartbeats: number;
}

interface HeartbeatsData {
  clients: { [key: string]: ClientData };
  lastCheck: string;
}

// Datos en memoria
let heartbeatsData: HeartbeatsData = {
  clients: {},
  lastCheck: new Date().toISOString()
};

// Cargar datos existentes al iniciar
async function loadHeartbeats(): Promise<void> {
  try {
    const data = await readFile(HEARTBEAT_FILE, 'utf8');
    heartbeatsData = JSON.parse(data);
    console.log('Heartbeats cargados desde archivo');
  } catch (error) {
    console.log('Creando nuevo archivo de heartbeats');
    await saveHeartbeats();
  }
}

// Guardar datos en archivo
async function saveHeartbeats(): Promise<void> {
  try {
    await writeFile(HEARTBEAT_FILE, JSON.stringify(heartbeatsData, null, 2));
  } catch (error) {
    console.error('Error guardando heartbeats:', error);
  }
}

// Middleware para tracking de heartbeats
function trackHeartbeat(req: Request, res: Response, next: NextFunction): void {
  if (req.path === '/heartbeat') {
    const clientId = (req.headers['client-id'] as string) || req.ip || 'unknown';
    const now = new Date();
    
    const existingClient = heartbeatsData.clients[clientId];
    
    heartbeatsData.clients[clientId] = {
      lastHeartbeat: now.toISOString(),
      ip: req.ip,
      userAgent: req.get('User-Agent') || undefined,
      totalHeartbeats: (existingClient?.totalHeartbeats || 0) + 1
    };

    // Guardar periódicamente (no en cada request para no saturar)
    if (Math.random() < 0.1) {
      saveHeartbeats().catch(console.error);
    }
  }
  next();
}

app.use(express.json());
app.use(trackHeartbeat);

app.get('/', (req: Request, res: Response) => {
  const now = new Date();
  const activeClients = Object.values(heartbeatsData.clients).filter(client => {
    const lastHeartbeat = new Date(client.lastHeartbeat);
    return (now.getTime() - lastHeartbeat.getTime()) < 300000; // 5 minutos
  }).length;

  const totalClients = Object.keys(heartbeatsData.clients).length;
  const serverStatus = totalClients > 0 ? 'online' : 'offline';
  const statusColor = serverStatus === 'online' ? '#22c55e' : '#ef4444';
  const statusEmoji = serverStatus === 'online' ? '🟢' : '🔴';

  // Obtener últimos 10 heartbeats para mostrar en logs
  const allHeartbeats = Object.entries(heartbeatsData.clients)
    .flatMap(([clientId, data]) => ({
      clientId,
      timestamp: new Date(data.lastHeartbeat),
      ip: data.ip,
      userAgent: data.userAgent
    }))
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
    .slice(0, 10);

  res.type('html').send(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8"/>
        <title>Heartbeat Monitor Dashboard</title>
        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
        <style>
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            max-width: 1200px;
            margin: 0 auto;
            padding: 20px;
            background-color: #0f172a;
            color: #e2e8f0;
          }
          .header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 30px;
            padding: 20px;
            background: #1e293b;
            border-radius: 10px;
          }
          .status-badge {
            display: flex;
            align-items: center;
            gap: 10px;
            padding: 10px 20px;
            background: ${statusColor}20;
            border: 2px solid ${statusColor};
            border-radius: 25px;
            font-weight: bold;
          }
          .dashboard {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 20px;
            margin-bottom: 30px;
          }
          .card {
            background: #1e293b;
            padding: 20px;
            border-radius: 10px;
            box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
          }
          .metrics {
            display: grid;
            grid-template-columns: repeat(3, 1fr);
            gap: 15px;
            margin-bottom: 20px;
          }
          .metric {
            text-align: center;
            padding: 15px;
            background: #334155;
            border-radius: 8px;
          }
          .metric-value {
            font-size: 24px;
            font-weight: bold;
            color: #60a5fa;
          }
          .metric-label {
            font-size: 14px;
            color: #94a3b8;
          }
          .log-entry {
            padding: 10px;
            margin: 5px 0;
            background: #334155;
            border-radius: 5px;
            border-left: 4px solid #60a5fa;
          }
          .log-time {
            color: #94a3b8;
            font-size: 12px;
          }
          .log-client {
            font-weight: bold;
            color: #60a5fa;
          }
          .chart-container {
            height: 300px;
            margin-top: 20px;
          }
          .warning {
            color: #fbbf24;
            font-weight: bold;
          }
          .danger {
            color: #ef4444;
            font-weight: bold;
          }
          nav {
            background: #1e293b;
            padding: 15px;
            border-radius: 10px;
            margin-bottom: 20px;
          }
          nav a {
            color: #60a5fa;
            text-decoration: none;
            margin-right: 20px;
            padding: 8px 16px;
            border-radius: 5px;
            transition: background 0.3s;
          }
          nav a:hover {
            background: #334155;
          }
        </style>
      </head>
      <body>
        <nav>
          <a href="/">Home</a>
          <a href="/about">Monitor</a>
          <a href="/api-data">API Data</a>
          <a href="/healthz">Health</a>
          <a href="/heartbeat-status">Raw Data</a>
        </nav>

        <div class="header">
          <h1>🚀 Heartbeat Monitor Dashboard</h1>
          <div class="status-badge">
            ${statusEmoji} Server ${serverStatus.toUpperCase()}
          </div>
        </div>

        <div class="metrics">
          <div class="metric">
            <div class="metric-value">${totalClients}</div>
            <div class="metric-label">Total Clients</div>
          </div>
          <div class="metric">
            <div class="metric-value">${activeClients}</div>
            <div class="metric-label">Active Clients</div>
          </div>
          <div class="metric">
            <div class="metric-value">${totalClients - activeClients}</div>
            <div class="metric-label">Inactive Clients</div>
          </div>
        </div>

        ${totalClients === 0 ? `
          <div class="card danger">
            <h3>⚠️ CRITICAL: No heartbeats detected</h3>
            <p>Server appears to be offline or no clients are connected.</p>
            <p>Last check: ${new Date().toLocaleString()}</p>
          </div>
        ` : ''}

        ${activeClients === 0 && totalClients > 0 ? `
          <div class="card warning">
            <h3>⚠️ WARNING: No active clients</h3>
            <p>All registered clients are inactive (last heartbeat > 5 minutes ago).</p>
            <p>Server might be experiencing issues.</p>
          </div>
        ` : ''}

        <div class="dashboard">
          <div class="card">
            <h3>📊 Activity Timeline (Last 24h)</h3>
            <div class="chart-container">
              <canvas id="activityChart"></canvas>
            </div>
          </div>

          <div class="card">
            <h3>📋 Recent Heartbeats</h3>
            <div style="max-height: 300px; overflow-y: auto;">
              ${allHeartbeats.length > 0 ? allHeartbeats.map(heartbeat => `
                <div class="log-entry">
                  <div class="log-time">${heartbeat.timestamp.toLocaleString()}</div>
                  <div><span class="log-client">${heartbeat.clientId}</span> - ${heartbeat.ip}</div>
                  <div style="font-size: 12px; color: #94a3b8;">${heartbeat.userAgent?.substring(0, 50)}...</div>
                </div>
              `).join('') : `
                <div style="text-align: center; padding: 40px; color: #94a3b8;">
                  No heartbeats recorded yet
                </div>
              `}
            </div>
          </div>
        </div>

        <script>
          // Datos para la gráfica (simplificado)
          const ctx = document.getElementById('activityChart').getContext('2d');
          new Chart(ctx, {
            type: 'line',
            data: {
              labels: ['6h', '5h', '4h', '3h', '2h', '1h', 'Now'],
              datasets: [{
                label: 'Heartbeats per hour',
                data: [12, 19, 8, 15, 22, 18, ${activeClients}],
                borderColor: '#60a5fa',
                backgroundColor: 'rgba(96, 165, 250, 0.1)',
                tension: 0.4,
                fill: true
              }]
            },
            options: {
              responsive: true,
              maintainAspectRatio: false,
              plugins: {
                legend: {
                  labels: {
                    color: '#e2e8f0'
                  }
                }
              },
              scales: {
                y: {
                  beginAtZero: true,
                  grid: {
                    color: 'rgba(255, 255, 255, 0.1)'
                  },
                  ticks: {
                    color: '#e2e8f0'
                  }
                },
                x: {
                  grid: {
                    color: 'rgba(255, 255, 255, 0.1)'
                  },
                  ticks: {
                    color: '#e2e8f0'
                  }
                }
              }
            }
          });

          // Auto-refresh cada 30 segundos
          setTimeout(() => {
            window.location.reload();
          }, 30000);
        </script>
      </body>
    </html>
  `);
});

// Example API endpoint - JSON
app.get('/api-data', (req: Request, res: Response) => {
  res.json({
    message: 'Here is some sample API data',
    items: ['apple', 'banana', 'cherry'],
  });
});

// Health check
app.get('/heartbeat', (req: Request, res: Response) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    message: 'Heartbeat received successfully'
  });
});

// Endpoint para ver estado de heartbeats
app.get('/heartbeat-status', (req: Request, res: Response) => {
  const now = new Date();
  const timeoutMinutes = parseInt(req.query.timeout as string) || 5;
  const cutoffTime = new Date(now.getTime() - timeoutMinutes * 60000);
  
  const clients = Object.entries(heartbeatsData.clients).map(([clientId, data]) => {
    const lastHeartbeat = new Date(data.lastHeartbeat);
    const minutesSinceLast = Math.floor((now.getTime() - lastHeartbeat.getTime()) / 60000);
    
    return {
      clientId,
      lastHeartbeat: data.lastHeartbeat,
      minutesSinceLast,
      status: lastHeartbeat > cutoffTime ? 'active' : 'inactive',
      ip: data.ip,
      totalHeartbeats: data.totalHeartbeats,
      userAgent: data.userAgent
    };
  });

  const activeClients = clients.filter(c => c.status === 'active');
  const inactiveClients = clients.filter(c => c.status === 'inactive');

  res.json({
    timestamp: now.toISOString(),
    timeoutMinutes,
    totalClients: clients.length,
    activeClients: activeClients.length,
    inactiveClients: inactiveClients.length,
    clients: clients.sort((a, b) => a.minutesSinceLast - b.minutesSinceLast),
    summary: {
      active: activeClients.length,
      inactive: inactiveClients.length,
      warning: inactiveClients.length > 0 ? '⚠️ Clientes inactivos detectados' : '✅ Todos los clientes activos'
    }
  });
});

// Limpiar clientes antiguos (opcional)
app.delete('/heartbeat-cleanup', async (req: Request, res: Response) => {
  const hours = parseInt(req.query.hours as string) || 24;
  const cutoffTime = new Date(Date.now() - hours * 3600000);
  
  let removedCount = 0;
  Object.keys(heartbeatsData.clients).forEach(clientId => {
    const clientData = heartbeatsData.clients[clientId];
    const lastHeartbeat = new Date(clientData.lastHeartbeat);
    if (lastHeartbeat < cutoffTime) {
      delete heartbeatsData.clients[clientId];
      removedCount++;
    }
  });

  await saveHeartbeats();
  
  res.json({
    message: `Removed ${removedCount} clients older than ${hours} hours`,
    remainingClients: Object.keys(heartbeatsData.clients).length
  });
});

// Health check extendido
app.get('/healthz', (req: Request, res: Response) => {
  const now = new Date();
  const activeClients = Object.values(heartbeatsData.clients).filter(client => {
    const lastHeartbeat = new Date(client.lastHeartbeat);
    return (now.getTime() - lastHeartbeat.getTime()) < 300000; // 5 minutos
  }).length;

  res.json({
    status: 'healthy',
    timestamp: now.toISOString(),
    totalClients: Object.keys(heartbeatsData.clients).length,
    activeClients: activeClients,
    uptime: process.uptime()
  });
});

// Inicializar y guardar periódicamente
loadHeartbeats().then(() => {
  // Guardar cada 5 minutos
  setInterval(saveHeartbeats, 300000);
});

// Guardar datos al cerrar la aplicación
process.on('SIGINT', async () => {
  console.log('Guardando heartbeats antes de cerrar...');
  await saveHeartbeats();
  process.exit(0);
});

export default app;