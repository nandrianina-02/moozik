// controllers/sessionController.js
// ─────────────────────────────────────────────────────────────────────────────
// Gestion des sessions actives : liste, révocation, déconnexion
// ─────────────────────────────────────────────────────────────────────────────
const Session = require('../models/Session');
const { hashToken } = require('../middleware/auth');

// ── GET /sessions ─────────────────────────────────────────────────────────────
// Retourne toutes les sessions actives de l'utilisateur connecté
exports.listSessions = async (req, res) => {
  try {
    const sessions = await Session.find({ userId: req.user.id, role: req.user.role })
      .select('-tokenHash')   // ne jamais exposer le hash
      .sort({ lastSeenAt: -1 });

    // Marquer la session courante
    const currentHash = hashToken(req.user.sessionId);
    const result = sessions.map(s => ({
      ...s.toObject(),
      isCurrent: hashToken(req.user.sessionId) === (() => {
        // On recharge le hash depuis le doc sans le select (déjà exclu)
        // On compare via un identifiant indirect : createdAt + ip
        return false; // recalculé ci-dessous
      })(),
    }));

    // Récupérer la session courante avec son hash pour la marquer
    const currentSession = await Session.findOne({
      userId:    req.user.id,
      tokenHash: currentHash,
    }).select('_id');

    const currentId = currentSession?._id?.toString();

    res.json(sessions.map(s => ({
      _id:        s._id,
      device:     s.device,
      ip:         s.ip,
      lastSeenAt: s.lastSeenAt,
      createdAt:  s.createdAt,
      expiresAt:  s.expiresAt,
      isCurrent:  s._id.toString() === currentId,
    })));
  } catch (e) {
    console.error('[listSessions]', e);
    res.status(500).json({ message: e.message });
  }
};

// ── DELETE /sessions/:id ──────────────────────────────────────────────────────
// Révoque une session spécifique (ne peut pas révoquer une session d'un autre user)
exports.revokeSession = async (req, res) => {
  try {
    const session = await Session.findById(req.params.id);
    if (!session) return res.status(404).json({ message: 'Session introuvable' });

    // Sécurité : un user ne peut révoquer que ses propres sessions
    if (String(session.userId) !== String(req.user.id)) {
      return res.status(403).json({ message: 'Accès refusé' });
    }

    await Session.deleteOne({ _id: req.params.id });
    res.json({ message: 'Session révoquée' });
  } catch (e) {
    console.error('[revokeSession]', e);
    res.status(500).json({ message: e.message });
  }
};

// ── DELETE /sessions ──────────────────────────────────────────────────────────
// Révoque TOUTES les sessions sauf la courante (déconnexion partout ailleurs)
exports.revokeAllOther = async (req, res) => {
  try {
    const currentHash = hashToken(req.user.sessionId);

    // Trouver la session courante pour l'exclure
    const current = await Session.findOne({
      userId:    req.user.id,
      tokenHash: currentHash,
    }).select('_id');

    const filter = { userId: req.user.id, role: req.user.role };
    if (current) filter._id = { $ne: current._id };

    const { deletedCount } = await Session.deleteMany(filter);
    res.json({ message: `${deletedCount} session(s) révoquée(s)` });
  } catch (e) {
    console.error('[revokeAllOther]', e);
    res.status(500).json({ message: e.message });
  }
};

// ── POST /sessions/logout ─────────────────────────────────────────────────────
// Déconnexion propre : supprime la session courante
exports.logout = async (req, res) => {
  try {
    if (req.user?.sessionId) {
      await Session.deleteOne({
        userId:    req.user.id,
        tokenHash: hashToken(req.user.sessionId),
      });
    }
    res.json({ message: 'Déconnecté' });
  } catch (e) {
    console.error('[logout]', e);
    res.status(500).json({ message: e.message });
  }
};

// ── Admin : GET /admin/sessions/:userId ───────────────────────────────────────
// Permet à un admin de voir et révoquer les sessions d'un utilisateur
exports.adminListUserSessions = async (req, res) => {
  try {
    const sessions = await Session.find({ userId: req.params.userId })
      .select('-tokenHash')
      .sort({ lastSeenAt: -1 });
    res.json(sessions);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

exports.adminRevokeUserSessions = async (req, res) => {
  try {
    const { deletedCount } = await Session.deleteMany({ userId: req.params.userId });
    res.json({ message: `${deletedCount} session(s) supprimée(s)` });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};