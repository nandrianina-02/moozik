const express  = require('express');
const router   = express.Router();
const { optionalAuth, requireAuth, requireAdmin } = require('../middleware/auth');
const playCtrl = require('../controllers/playController');
const royCtrl  = require('../controllers/royaltiesController');
const { calculateRoyalties } = require('../jobs/royaltiesCron');

// ── Écoutes
router.post('/songs/:id/play', optionalAuth, playCtrl.recordPlay);

// ── Artiste
router.get('/artists/:id/royalties', requireAuth, royCtrl.getArtistRoyalties);
router.put('/artists/:id/payout',    requireAuth, royCtrl.savePayoutInfo);

// ── Admin
router.get('/admin/royalties',         requireAdmin, royCtrl.getAdminRoyalties);
router.post('/admin/royalties/payout', requireAdmin, royCtrl.triggerPayout);

// ── Calcul manuel (test)
router.post('/admin/royalties/calculate', requireAdmin, async (req, res) => {
  try {
    const period = req.body.period || new Date().toISOString().slice(0, 7);
    const result = await calculateRoyalties(period);
    res.json(result);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

router.get('/admin/royalties/plays-debug', requireAdmin, async (req, res) => {
  const Play = require('../models/Play');
  const period = req.query.period || new Date().toISOString().slice(0, 7);
  const total     = await Play.countDocuments({});
  const thisPeriod = await Play.countDocuments({ period });
  const uncounted  = await Play.countDocuments({ period, counted: false });
  const withArtist = await Play.countDocuments({ period, artisteId: { $ne: null } });
  const sample     = await Play.find({}).limit(3).lean();
  res.json({ total, thisPeriod, uncounted, withArtist, sample });
});

module.exports = router;