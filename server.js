require('dotenv').config();

const express    = require('express');
const mongoose   = require('mongoose');
const compression = require('compression');
const http       = require('http');

const { createIndexes } = require('./models');
const routes = require('./routes');

// ── App ───────────────────────────────────────
const app = express();

// ── CORS ──────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin',  '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(compression({ level: 6, threshold: 1024 }));
app.use(express.json());

// ── MongoDB ───────────────────────────────────
mongoose.connect(process.env.MONGO_URI)
  .then(() => { console.log('✅ MongoDB connecté'); createIndexes(); })
  .catch(err => console.error('❌ MongoDB :', err));

// ── Routes ────────────────────────────────────
app.use('/', routes);

// ── Health check ──────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// ── Error handler ─────────────────────────────
app.use((err, _req, res, _next) => {
  console.error('Unhandled error:', err.message);
  res.status(err.status || 500).json({ message: err.message || 'Erreur serveur' });
});

// ══════════════════════════════════════════════
// HTTP + WebSocket server
// ══════════════════════════════════════════════
const PORT   = process.env.PORT || 5000;
const server = http.createServer(app);

server.listen(PORT, '0.0.0.0', () => console.log(`🚀 Serveur sur le port ${PORT}`));

// ── WebSocket — auditeurs en temps réel ───────
const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');

const wss       = new WebSocketServer({ server });
const listeners = new Map();

setInterval(() => {
  listeners.forEach((v, k) => { if (v.ws.readyState !== 1) listeners.delete(k); });
}, 30_000);

function broadcast() {
  const users = [...listeners.values()].map(l => ({
    nom: l.nom, avatar: l.avatar, songId: l.songId,
    songTitle: l.songTitle, artiste: l.artiste, image: l.image,
  }));
  const payload = JSON.stringify({ type: 'listeners', users });
  wss.clients.forEach(c => { if (c.readyState === 1) c.send(payload); });
}

wss.on('connection', ws => {
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    if (msg.type === 'join') {
      let nom = 'Anonyme', avatar = null;
      try {
        const d = jwt.verify(msg.token, process.env.JWT_SECRET);
        nom    = d.nom || d.email || 'Utilisateur';
        avatar = d.avatar || null;
      } catch {}
      listeners.set(msg.token, { ws, nom, avatar, songId: msg.songId, songTitle: msg.songTitle, artiste: msg.artiste, image: msg.image, lastSeen: Date.now() });
      broadcast();
    }
    if (msg.type === 'leave')  { listeners.delete(msg.token); broadcast(); }
    if (msg.type === 'ping')   { const e = listeners.get(msg.token); if (e) e.lastSeen = Date.now(); ws.send(JSON.stringify({ type: 'pong' })); }
  });

  ws.on('close', () => { listeners.forEach((v, k) => { if (v.ws === ws) listeners.delete(k); }); broadcast(); });
  ws.on('error', () => ws.close());
});