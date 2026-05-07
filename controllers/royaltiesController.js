const mongoose   = require('mongoose');
const { Royalty, ArtistPayout, Tip } = require('../models/monetisationModels');
const Play = require('../models/Play');

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

    // ✅ ArtistPayout (modèle fusionné) — plus PayoutInfo
    const payout = await ArtistPayout.findOne({ artisteId }).lean();

    let totalTipsEuros = '0.00';
    try {
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

    // ✅ ArtistPayout (modèle fusionné) — plus PayoutInfo
    const updated = await ArtistPayout.findOneAndUpdate(
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

    // Les documents en base utilisent le champ `artistId` (pas `artisteId`)
    // On fait le populate manuellement via aggregation pour éviter l'incohérence
    const royalties = await Royalty.aggregate([
      { $match: { period } },
      { $sort: { revenue: -1 } },
      {
        $lookup: {
          from:         'artists',       // nom de la collection MongoDB (pluriel lowercase)
          localField:   'artistId',      // champ réel dans les documents Royalty
          foreignField: '_id',
          as:           'artisteId',     // on expose sous artisteId pour que le front marche
        },
      },
      {
        $addFields: {
          artisteId: { $arrayElemAt: ['$artisteId', 0] }, // déplie le tableau
        },
      },
      {
        $project: {
          period: 1, plays: 1, revenue: 1, status: 1, sources: 1, currency: 1,
          'artisteId._id': 1,
          'artisteId.nom': 1,
          'artisteId.image': 1,
        },
      },
    ]);

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
      status:  'pending',
      revenue: { $gt: 0 },
    })
      .populate('artisteId', 'nom')  // ✅ artisteId
      .lean();

    if (pending.length === 0) {
      return res.json({ message: `Aucune royaltie en attente pour ${period}` });
    }

    let versed = 0;
    for (const royalty of pending) {
      // Passer en "processing" côté Royalty
      await Royalty.findByIdAndUpdate(royalty._id, {
        status: 'processing',
        paidAt: new Date(),
      });

      // ✅ ArtistPayout (modèle fusionné) — décrémenter pendingBalance, incrémenter totalPaid
      await ArtistPayout.findOneAndUpdate(
        { artisteId: royalty.artisteId._id },
        {
          $inc: {
            pendingBalance: -royalty.revenue, // on débite ce qui part en virement
            totalPaid:       royalty.revenue,
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