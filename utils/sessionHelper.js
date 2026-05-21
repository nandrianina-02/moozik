// utils/sessionHelper.js
// ─────────────────────────────────────────────────────────────────────────────
// Fonctions utilitaires pour créer une session unique lors de la connexion.
// Utilisé par authController pour user, artist et admin.
// ─────────────────────────────────────────────────────────────────────────────
const Session = require('../models/Session');
const { signToken, hashToken, parseDevice, getIp, computeExpiresAt } = require('../middleware/auth');

/**
 * Crée un token JWT + une session en base.
 * Supprime TOUTES les sessions précédentes du même user (session unique).
 *
 * @param {Object} payload   - Données à embarquer dans le JWT (id, email, role, nom…)
 * @param {Object} req       - Requête Express (pour UA et IP)
 * @param {string} duration  - Durée du token ex: '30d', '7d'
 * @returns {string}         - Le JWT signé
 */
const createUniqueSession = async (payload, req, duration = '30d') => {
  // 1. Signer le JWT (retourne token + sessionId)
  const { token, sessionId } = signToken(payload, duration);

  // 2. Supprimer toutes les sessions précédentes → session unique
  await Session.deleteMany({ userId: payload.id, role: payload.role });

  // 3. Créer la nouvelle session en base
  const device = parseDevice(req.headers['user-agent'] || '');
  const ip     = getIp(req);

  await Session.create({
    userId:    payload.id,
    role:      payload.role,
    tokenHash: hashToken(sessionId),
    device,
    ip,
    lastSeenAt: new Date(),
    expiresAt:  computeExpiresAt(duration),
  });

  return token;
};

module.exports = { createUniqueSession };