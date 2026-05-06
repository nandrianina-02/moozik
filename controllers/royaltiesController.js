const mongoose       = require('mongoose');
const { Royalty, ArtistPayout, Tip } = require('../models/monetisationModels');
const Play           = require('../models/Play');
// Champ canonical du schema : artisteId (avec e)

// ─────────────────────────────────────────────
// GET /artists/:id/royalties
// ─────────────────────────────────────────────
exports.getArtistRoyalties = async (req, res) => {
  try {
    const artistId = req.params.id;

    const royalties = await Royalty.find({ artistId })
      .sort({ period: -1 })
      .limit(12)
      .lean();

    const payout = await ArtistPayout.findOne({ artistId }).lean();

    let totalTipsEuros = '0.00';
    try {
      const agg = await Tip.aggregate([
        { $match: { toArtistId: new mongoose.Types.ObjectId(artistId) } },
        { $group: { _id: null, total: { $sum: '$amount' } } },
      ]);
      totalTipsEuros = ((agg[0]?.total || 0) / 100).toFixed(2);
    } catch (_) {}

    res.json({
      royalties,
      payout: payout || {
        pendingBalance:      0,
        totalEarned:         0,
        paypalEmail:         '',
        mobileMoneyPhone:    '',
        mobileMoneyProvider: 'none',
        stripeAccountId:     '',
        onboardingDone:      false,
      },
      totalTipsEuros,
    });
  } catch (e) {
    console.error('getArtistRoyalties error:', e);
    res.status(500).json({ message: e.message });
  }
};

// ─────────────────────────────────────────────
// PUT /artists/:id/payout
// ─────────────────────────────────────────────
exports.savePayoutInfo = async (req, res) => {
  try {
    const { paypalEmail, mobileMoneyPhone, mobileMoneyProvider } = req.body;
    const updated = await ArtistPayout.findOneAndUpdate(
      { artistId: req.params.id },
      { paypalEmail, mobileMoneyPhone, mobileMoneyProvider },
      { upsert: true, new: true }
    );
    res.json(updated);
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// ─────────────────────────────────────────────
// GET /admin/royalties?period=2026-05
// Supprimée — gérée dans monetisationRoutes.js
// Si tu veux la garder ici, décommente ci-dessous
// ET supprime la route dans monetisationRoutes.js
// ─────────────────────────────────────────────
// exports.getAdminRoyalties = async (req, res) => { ... };

// ─────────────────────────────────────────────
// POST /admin/royalties/payout
// ─────────────────────────────────────────────
exports.triggerPayout = async (req, res) => {
  try {
    const period = req.body.period || new Date().toISOString().slice(0, 7);

    const pending = await Royalty.find({
      period,
      status:  'pending',
      revenue: { $gt: 0 },
    }).populate('artistId').lean();

    if (pending.length === 0) {
      return res.json({ message: `Aucune royaltie en attente pour ${period}` });
    }

    let versed = 0;
    for (const royalty of pending) {
      await Royalty.findByIdAndUpdate(royalty._id, {
        status: 'processing',
        paidAt: new Date(),
      });

      await ArtistPayout.findOneAndUpdate(
        { artistId: royalty.artistId._id },
        {
          $inc: {
            pendingBalance: royalty.revenue,
            totalEarned:    royalty.revenue,
          },
        },
        { upsert: true }
      );
      versed++;
    }

    res.json({
      message: `${versed} artiste(s) mis en traitement pour ${period}`,
      period,
      versed,
    });
  } catch (e) {
    console.error('triggerPayout error:', e);
    res.status(500).json({ message: e.message });
  }
};