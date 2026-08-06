const express  = require('express');
const { spawn } = require('child_process');
const path     = require('path');
const fs       = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

// Permite que el frontend Next.js (que corre en otro puerto, ej. 3000 vs 4000)
// llame a /status y /run. Solo agrega cabeceras CORS, no cambia ninguna
// lógica existente.
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
});

// Sirve index.html y cualquier otro archivo estático del mismo directorio
app.use(express.static(__dirname));

// Estado compartido: solo un proceso a la vez
let running = false;

// ── GET /status ────────────────────────────────────────────────────────────────
// El frontend lo consulta al cargar para saber si hay una corrida en curso.
app.get('/status', (req, res) => {
  res.json({ running });
});

// ── POST /run ──────────────────────────────────────────────────────────────────
// Ejecuta `node index.js` y hace streaming de los logs via Server-Sent Events.
// El cliente lee el stream y muestra los logs en tiempo real; cuando termina,
// recibe un evento "done" y recarga el panel con los nuevos resultados.
app.post('/run', (req, res) => {
  if (running) {
    res.status(409).json({ error: 'Ya hay una actualización en curso.' });
    return;
  }

  running = true;

  // Cabeceras SSE
  res.setHeader('Content-Type',  'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection',    'keep-alive');
  res.flushHeaders();

  const send = (event, data) =>
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

  send('log', { text: '🚀 Iniciando actualización...' });

  const child = spawn('node', ['index.js'], {
    cwd:   __dirname,
    env:   process.env,
    shell: false,
  });

  child.stdout.on('data', (chunk) => {
    chunk.toString().split('\n').filter(Boolean).forEach((line) => {
      send('log', { text: line });
    });
  });

  child.stderr.on('data', (chunk) => {
    chunk.toString().split('\n').filter(Boolean).forEach((line) => {
      send('log', { text: `⚠️ ${line}` });
    });
  });

  child.on('close', (code) => {
    running = false;
    if (code === 0) {
      send('done', { ok: true,  text: '✅ Actualización completada.' });
    } else {
      send('done', { ok: false, text: `❌ El script terminó con código ${code}.` });
    }
    res.end();
  });

  child.on('error', (err) => {
    running = false;
    send('done', { ok: false, text: `❌ Error al lanzar el script: ${err.message}` });
    res.end();
  });

  // Si el cliente cierra la conexión antes de que termine, matamos el proceso
  req.on('close', () => {
    if (running) {
      child.kill();
      running = false;
    }
  });
});

app.listen(PORT, () => {
  console.log(`✅ Servidor corriendo en http://localhost:${PORT}`);
  console.log(`   Abre esa URL en tu navegador para ver el panel.`);
});