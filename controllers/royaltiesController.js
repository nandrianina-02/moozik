const mongoose   = require('mongoose');
const { Royalty } = require('../models/monetisationModels');
const PayoutInfo = require('../models/PayoutInfo');
const Play       = require('../models/Play');

// ─────────────────────────────────────────────
// GET /artists/:id/royalties
// ─────────────────────────────────────────────
exports.getArtistRoyalties = async (req, res) => {
  try {
    const artisteId = req.params.id;

    const royalties = await Royalty.find({ artisteId })
      .sort({ period: -1 })
      .limit(12)
      .lean();

    const payout = await PayoutInfo.findOne({ artisteId }).lean();

    let totalTipsEuros = '0.00';
    try {
      const Tip = require('../models/monetisationModels').Tip;
      const agg = await Tip.aggregate([
        { $match: { toArtistId: new mongoose.Types.ObjectId(artisteId) } },
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
    const updated = await PayoutInfo.findOneAndUpdate(
      { artisteId: req.params.id },
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
// ─────────────────────────────────────────────
exports.getAdminRoyalties = async (req, res) => {
  try {
    const period = req.query.period || new Date().toISOString().slice(0, 7);

    const royalties = await Royalty.find({ period })
      .populate('artistId', 'nom image')
      .sort({ revenue: -1 })
      .lean();

    const totalCents = royalties.reduce((s, r) => s + (r.revenue || 0), 0);

    res.json({
      period,
      royalties,
      totalEuros: (totalCents / 100).toFixed(2),
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
};

// ─────────────────────────────────────────────
// POST /admin/royalties/payout
// ─────────────────────────────────────────────
exports.triggerPayout = async (req, res) => {
  try {
    const period = req.body.period || new Date().toISOString().slice(0, 7);

    const pending = await Royalty.find({
      period,
      status: 'pending',
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

      await PayoutInfo.findOneAndUpdate(
        { artisteId: royalty.artisteId._id },
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