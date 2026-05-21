// models/Session.js
// Stocke les sessions actives. 1 user = 1 session max.
const mongoose = require('mongoose');

const sessionSchema = new mongoose.Schema({
  // Référence user (fonctionne aussi pour Artist et Admin avec discriminator string)
  userId: {
    type:     mongoose.Schema.Types.ObjectId,
    required: true,
    index:    true,
  },
  // Rôle pour savoir de quel modèle vient userId
  role: {
    type:    String,
    enum:    ['user', 'artist', 'admin'],
    required: true,
  },
  // SHA-256 du sessionToken inclus dans le JWT — jamais le raw token
  tokenHash: {
    type:     String,
    required: true,
    unique:   true,
    index:    true,
    select:   false,   // jamais exposé en clair
  },
  // Infos appareil / navigateur (parsées côté serveur depuis User-Agent)
  device: {
    browser: { type: String, default: 'Inconnu' },
    os:      { type: String, default: 'Inconnu' },
    type:    { type: String, default: 'desktop' }, // 'mobile' | 'tablet' | 'desktop'
  },
  // IP de connexion (IPv4 ou IPv6)
  ip: {
    type:    String,
    default: '',
  },
  // Dernière activité (mise à jour à chaque requête authentifiée)
  lastSeenAt: {
    type:    Date,
    default: Date.now,
  },
  // Expiration automatique via TTL index MongoDB
  expiresAt: {
    type:  Date,
    index: { expires: 0 },  // MongoDB supprime le document quand expiresAt est dépassé
  },
}, { timestamps: true });

// Index composite pour les requêtes "toutes les sessions d'un user"
sessionSchema.index({ userId: 1, role: 1 });

module.exports = mongoose.models.Session || mongoose.model('Session', sessionSchema);