require('dotenv').config();
// TEST SMTP — à supprimer après confirmation
console.log('SMTP config:', {
  host:   process.env.SMTP_HOST,
  port:   process.env.SMTP_PORT,
  user:   process.env.SMTP_USER,
  pass:   process.env.SMTP_PASS ? '✅ défini' : '❌ MANQUANT',
  from:   process.env.SMTP_FROM,
  frontend: process.env.FRONTEND_URL,
});

// Dans server.js, juste après le console.log SMTP
const nodemailer = require('nodemailer');
const testTransporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   587,
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

testTransporter.verify((err, success) => {
  if (err) console.error('❌ SMTP ERROR:', JSON.stringify(err, null, 2));
  else {
    console.log('✅ SMTP connecté — envoi test...');
    testTransporter.sendMail({
      from:    process.env.SMTP_USER,
      to:      'dodisoa.nandrianina@gmail.com',  // s'envoie à soi-même
      subject: 'Test Moozik SMTP',
      text:    'Si tu reçois ça, le SMTP fonctionne.',
    }, (err, info) => {
      if (err) console.error('❌ Envoi échoué:', JSON.stringify(err, null, 2));
      else     console.log('✅ Email envoyé:', info.messageId);
    });
  }
});

const express    = require('express');
const mongoose   = require('mongoose');
const compression = require('compression');
const http       = require('http');

const { createIndexes } = require('./models');
const { router: routes } = require('./routes');

const featureRoutes = require('./routes/featureRoutes');

// ── App ───────────────────────────────────────
const app = express();

const monetisationRoutes = require('./routes/monetisationRoutes');

const analyticsRoutes = require('./routes/analyticsRoutes');

const radioRoutes = require('./routes/radioRoutes');
const adminRoutes = require('./routes/adminRoutes');
const tsComments = require('./routes/timestampCommentRoutes');
const { startRoyaltiesCron } = require('./jobs/royaltiesCron');
const royaltiesRoutes        = require('./routes/royalties');

// ── CORS ──────────────────────────────────────
const cors = require('cors');

app.use(cors({
  origin: true,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// Force le header pour Cloudflare/Render
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('X-Custom-Test', 'hello'); // ← test
  next();
});

app.use(compression({ level: 6, threshold: 1024 }));
app.use(express.json());

// ── MongoDB ───────────────────────────────────
mongoose.connect(process.env.MONGO_URI).then(async () => {
  const { User } = require('./models');
  await User.updateMany({ banned: { $exists: false } }, { $set: { banned: false } });
  console.log('✅ MongoDB connecté');
  createIndexes();
  startRoyaltiesCron();
});

// ── Routes ────────────────────────────────────
app.post('/webhooks/stripe',
  express.raw({ type: 'application/json' }),
  (req, res, next) => { req.rawBody = req.body; next(); }
);
app.use('/', monetisationRoutes);
app.use('/', routes);
app.use('/', featureRoutes);
app.use('/', analyticsRoutes);
app.use('/', radioRoutes);
app.use('/admin', adminRoutes);
app.use('/', tsComments);
app.use('/', royaltiesRoutes);


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

const wss = new WebSocketServer({ server, path: '/ws/listeners' });
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

