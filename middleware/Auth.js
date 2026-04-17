const jwt = require('jsonwebtoken');

const SECRET = () => process.env.JWT_SECRET;

// ── Vérifie tout token valide ─────────────────
const requireAuth = (req, res, next) => {
  const t = req.headers.authorization?.split(' ')[1];
  if (!t) return res.status(401).json({ message: 'Non autorisé' });
  try { req.user = jwt.verify(t, SECRET()); next(); }
  catch { res.status(401).json({ message: 'Token invalide' }); }
};

// ── Admin seulement ───────────────────────────
const requireAdmin = (req, res, next) => {
  const t = req.headers.authorization?.split(' ')[1];
  if (!t) return res.status(401).json({ message: 'Non autorisé' });
  try {
    req.admin = jwt.verify(t, SECRET());
    if (req.admin.role !== 'admin') return res.status(403).json({ message: 'Accès refusé' });
    req.user = req.admin; // alias pratique
    next();
  } catch { res.status(401).json({ message: 'Token invalide' }); }
};

// ── Artiste ou admin ──────────────────────────
const requireArtist = (req, res, next) => {
  const t = req.headers.authorization?.split(' ')[1];
  if (!t) return res.status(401).json({ message: 'Non autorisé' });
  try {
    const d = jwt.verify(t, SECRET());
    if (d.role !== 'artist' && d.role !== 'admin') return res.status(403).json({ message: 'Accès refusé' });
    req.user = d; next();
  } catch { res.status(401).json({ message: 'Token invalide' }); }
};

// ── Tout utilisateur authentifié ──────────────
const requireAdminOrArtist = (req, res, next) => {
  const t = req.headers.authorization?.split(' ')[1];
  if (!t) return res.status(401).json({ message: 'Non autorisé' });
  try { req.user = jwt.verify(t, SECRET()); next(); }
  catch { res.status(401).json({ message: 'Token invalide' }); }
};

// ── Optionnel (passe même sans token) ────────
const optionalAuth = (req, res, next) => {
  const t = req.headers.authorization?.split(' ')[1];
  if (t) { try { req.user = jwt.verify(t, SECRET()); } catch {} }
  next();
};

// ── Helper : signer un token ──────────────────
const signToken = (payload, expiresIn = '30d') =>
  jwt.sign(payload, SECRET(), { expiresIn });

// ── Helper : vérifier un token ────────────────
const verifyToken = (token) => jwt.verify(token, SECRET());

module.exports = { requireAuth, requireAdmin, requireArtist, requireAdminOrArtist, optionalAuth, signToken, verifyToken };