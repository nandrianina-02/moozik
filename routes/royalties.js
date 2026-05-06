const express  = require('express');
const router   = express.Router();
const { optionalAuth, requireAuth, requireAdmin } = require('../middleware/auth');
const playCtrl = require('../controllers/playController');
const royCtrl  = require('../controllers/royaltiesController');

// ── Écoutes (public, user optionnel) ─────────
router.post('/songs/:id/play', optionalAuth, playCtrl.recordPlay);

// ── Artiste ───────────────────────────────────
router.get('/artists/:id/royalties', requireAuth, royCtrl.getArtistRoyalties);
router.put('/artists/:id/payout',    requireAuth, royCtrl.savePayoutInfo);

// ── Admin ─────────────────────────────────────
router.get('/admin/royalties',         requireAdmin, royCtrl.getAdminRoyalties);
router.post('/admin/royalties/payout', requireAdmin, royCtrl.triggerPayout);

module.exports = router;