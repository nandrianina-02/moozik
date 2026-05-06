const cron     = require('node-cron');
const mongoose = require('mongoose');
const Play     = require('../models/Play');
const { Royalty } = require('../models/monetisationModels');
const PayoutInfo  = require('../models/PayoutInfo');

const RATE_FREE    = 0.001;
const RATE_PREMIUM = 0.004;
const PLATFORM_CUT = 0.20;

const previousPeriod = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
};

const calculateRoyalties = async (period) => {
  console.log(`[ROYALTIES] ▶ Calcul pour ${period}...`);

  try {
    const plays = await Play.aggregate([
      { $match: { period, counted: false, artisteId: { $ne: null } } },
      {
        $group: {
          _id: { artisteId: '$artisteId', isPremium: '$isPremium' },
          count: { $sum: 1 },
        },
      },
    ]);

    if (plays.length === 0) {
      console.log(`[ROYALTIES] Aucune écoute à traiter pour ${period}`);
      return { processed: 0, period };
    }

    const byArtist = {};
    for (const p of plays) {
      const aid = String(p._id.artisteId);
      if (!byArtist[aid]) byArtist[aid] = { free: 0, premium: 0, totalPlays: 0 };
      if (p._id.isPremium) byArtist[aid].premium += p.count;
      else                 byArtist[aid].free    += p.count;
      byArtist[aid].totalPlays += p.count;


    }

    const purchaseByArtist = {};
    try {
      const { Purchase } = require('../models/monetisationModels');
      const purchases = await Purchase.aggregate([
        { $match: { period, status: 'completed', artistId: { $ne: null } } },
        { $group: { _id: '$artistId', total: { $sum: '$artistShare' } } },
      ]);
      for (const p of purchases) purchaseByArtist[String(p._id)] = p.total;
    } catch (_) {}

    const col = Royalty.collection;
    let processed = 0;

    for (const [artisteId, data] of Object.entries(byArtist)) {
        const fromFree    = Math.ceil(data.free    * RATE_FREE    * 100);
        const fromPremium = Math.ceil(data.premium * RATE_PREMIUM * 100);
        const fromSales   = purchaseByArtist[artisteId] || 0;

      const netRevenue = Math.ceil(
        (fromFree + fromPremium) * (1 - PLATFORM_CUT) + fromSales
      );

      if (netRevenue < 0) continue;

      // Bypass strict mode — accès direct MongoDB
      const result = await col.updateOne(
        {
          artistId: new mongoose.Types.ObjectId(artisteId),
          period,
        },
        {
          $setOnInsert: { status: 'pending', currency: 'EUR' },
          $inc: {
            plays:               data.totalPlays,
            'sources.premium':   fromPremium,
            'sources.purchases': fromSales,
            revenue:             netRevenue,
          },
        },
        { upsert: true }
      );


      // Mettre à jour le solde artiste
      await PayoutInfo.updateOne(
        { artisteId },
        {
          $setOnInsert: { artisteId },
          $inc: {
            pendingBalance: netRevenue,
            totalEarned:    netRevenue,
          },
        },
        { upsert: true }
      );

      processed++;
    }

    const { modifiedCount } = await Play.updateMany(
      { period, counted: false },
      { $set: { counted: true } }
    );

    console.log(`[ROYALTIES] ✅ ${processed} artiste(s), ${modifiedCount} écoutes marquées`);
    return { processed, period };

  } catch (e) {
    console.error('[ROYALTIES] ❌ Erreur:', e);
    throw e;
  }
};

const startRoyaltiesCron = () => {
  cron.schedule('0 2 1 * *', async () => {
    const period = previousPeriod();
    await calculateRoyalties(period);
  }, { timezone: 'UTC' });

  console.log('[ROYALTIES] ⏰ Cron planifié — 1er du mois à 02:00 UTC');
};

module.exports = { startRoyaltiesCron, calculateRoyalties };