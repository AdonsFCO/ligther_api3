import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { writeFile, readFile } from 'fs/promises'
import { ParsedQs } from 'qs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const app = express()
const HEARTBEAT_FILE = 'heartbeats.json'

// Interfaces para TypeScript
interface ClientData {
  lastHeartbeat: string;
  ip: string;
  userAgent: string;
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
}

// Cargar datos existentes al iniciar
async function loadHeartbeats() {
  try {
    const data = await readFile(HEARTBEAT_FILE, 'utf8')
    heartbeatsData = JSON.parse(data)
    console.log('Heartbeats cargados desde archivo')
  } catch (error) {
    console.log('Creando nuevo archivo de heartbeats')
    await saveHeartbeats()
  }
}

// Guardar datos en archivo
async function saveHeartbeats() {
  try {
    await writeFile(HEARTBEAT_FILE, JSON.stringify(heartbeatsData, null, 2))
  } catch (error) {
    console.error('Error guardando heartbeats:', error)
  }
}

// Middleware para tracking de heartbeats
function trackHeartbeat(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.path === '/heartbeat') {
    const clientId = (req.headers['client-id'] as string) || req.ip || 'unknown'
    const now = new Date()
    
    heartbeatsData.clients[clientId] = {
      lastHeartbeat: now.toISOString(),
      ip: req.ip || 'unknown',
      userAgent: req.get('User-Agent') || 'unknown',
      totalHeartbeats: (heartbeatsData.clients[clientId]?.totalHeartbeats || 0) + 1
    }

    // Guardar periódicamente (no en cada request para no saturar)
    if (Math.random() < 0.1) { // 10% de probabilidad de guardar
      saveHeartbeats().catch(console.error)
    }
  }
  next()
}

app.use(express.json())
app.use(trackHeartbeat)

// Home route - HTML
app.get('/', (req, res) => {
  res.type('html').send(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8"/>
        <title>Express on Vercel</title>
        <link rel="stylesheet" href="/style.css" />
      </head>
      <body>
        <nav>
          <a href="/">Home</a>
          <a href="/about">About</a>
          <a href="/api-data">API Data</a>
          <a href="/healthz">Health</a>
          <a href="/heartbeat-status">Heartbeat Status</a>
        </nav>
        <h1>Welcome to Express on Vercel 🚀</h1>
        <p>This is a minimal example with heartbeat monitoring.</p>
        <img src="/logo.png" alt="Logo" width="120" />
      </body>
    </html>
  `)
})

app.get('/about', function (req, res) {
  res.sendFile(path.join(__dirname, '..', 'components', 'about.htm'))
})

// Example API endpoint - JSON
app.get('/api-data', (req, res) => {
  res.json({
    message: 'Here is some sample API data',
    items: ['apple', 'banana', 'cherry'],
  })
})

// Health check
app.get('/heartbeat', (req, res) => {
  res.status(200).json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    message: 'Heartbeat received successfully'
  })
})

// Endpoint para ver estado de heartbeats
app.get('/heartbeat-status', (req, res) => {
  const now = new Date()
  const timeoutMinutes = parseInt(req.query.timeout as string) || 5
  const cutoffTime = new Date(now.getTime() - timeoutMinutes * 60000)
  
  const clients = Object.entries(heartbeatsData.clients).map(([clientId, data]) => {
    const lastHeartbeat = new Date(data.lastHeartbeat)
    const minutesSinceLast = Math.floor((now.getTime() - lastHeartbeat.getTime()) / 60000)
    
    return {
      clientId,
      lastHeartbeat: data.lastHeartbeat,
      minutesSinceLast,
      status: lastHeartbeat > cutoffTime ? 'active' : 'inactive',
      ip: data.ip,
      totalHeartbeats: data.totalHeartbeats,
      userAgent: data.userAgent
    }
  })

  const activeClients = clients.filter(c => c.status === 'active')
  const inactiveClients = clients.filter(c => c.status === 'inactive')

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
  })
})

// Limpiar clientes antiguos (opcional)
app.delete('/heartbeat-cleanup', async (req, res) => {
  const hours = parseInt(req.query.hours as string) || 24
  const cutoffTime = new Date(Date.now() - hours * 3600000)
  
  let removedCount = 0
  Object.keys(heartbeatsData.clients).forEach(clientId => {
    const clientData = heartbeatsData.clients[clientId]
    const lastHeartbeat = new Date(clientData.lastHeartbeat)
    if (lastHeartbeat < cutoffTime) {
      delete heartbeatsData.clients[clientId]
      removedCount++
    }
  })

  await saveHeartbeats()
  
  res.json({
    message: `Removed ${removedCount} clients older than ${hours} hours`,
    remainingClients: Object.keys(heartbeatsData.clients).length
  })
})

// Health check extendido
app.get('/healthz', (req, res) => {
  const now = new Date()
  const activeClients = Object.values(heartbeatsData.clients).filter(client => {
    const lastHeartbeat = new Date(client.lastHeartbeat)
    return (now.getTime() - lastHeartbeat.getTime()) < 300000 // 5 minutos
  }).length

  res.json({
    status: 'healthy',
    timestamp: now.toISOString(),
    totalClients: Object.keys(heartbeatsData.clients).length,
    activeClients: activeClients,
    uptime: process.uptime()
  })
})

// Inicializar y guardar periódicamente
loadHeartbeats().then(() => {
  // Guardar cada 5 minutos
  setInterval(saveHeartbeats, 300000)
})

// Guardar datos al cerrar la aplicación
process.on('SIGINT', async () => {
  console.log('Guardando heartbeats antes de cerrar...')
  await saveHeartbeats()
  process.exit(0)
})

export default app