// routes/sessionRoutes.js
const router = require('express').Router();
const { requireAuth, requireAdmin } = require('../middleware/auth');
const ctrl = require('../controllers/sessionController');

// ── Sessions de l'utilisateur connecté ───────────────────────────────────────
router.get    ('/',             requireAuth, ctrl.listSessions);
router.delete ('/logout',       requireAuth, ctrl.logout);
router.delete ('/all-others',   requireAuth, ctrl.revokeAllOther);
router.delete ('/:id',          requireAuth, ctrl.revokeSession);

// ── Administration ────────────────────────────────────────────────────────────
router.get    ('/admin/:userId', requireAdmin, ctrl.adminListUserSessions);
router.delete ('/admin/:userId', requireAdmin, ctrl.adminRevokeUserSessions);

module.exports = router;