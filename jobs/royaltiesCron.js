const cron       = require('node-cron');
const Play       = require('../models/Play');
const { Royalty } = require('../models/monetisationModels');
const PayoutInfo = require('../models/PayoutInfo');

// ─────────────────────────────────────────────
// TAUX (euros par écoute)
// ─────────────────────────────────────────────
const RATE_FREE    = 0.001; // 0,001 € par écoute gratuite
const RATE_PREMIUM = 0.004; // 0,004 € par écoute premium
const PLATFORM_CUT = 0.20;  // 20% commission plateforme

// ─────────────────────────────────────────────
// Période précédente "YYYY-MM"
// ─────────────────────────────────────────────
const previousPeriod = () => {
  const d = new Date();
  d.setMonth(d.getMonth() - 1);
  return d.toISOString().slice(0, 7);
};

// ─────────────────────────────────────────────
// Calcul principal — appelable manuellement aussi
// ─────────────────────────────────────────────
const calculateRoyalties = async (period) => {
  console.log(`[ROYALTIES] ▶ Calcul pour ${period}...`);

  try {
    // 1. Agréger les écoutes non comptabilisées de la période
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

    // 2. Regrouper par artiste
    const byArtist = {};
    for (const p of plays) {
      const aid = String(p._id.artisteId);
      if (!byArtist[aid]) byArtist[aid] = { free: 0, premium: 0, totalPlays: 0 };
      if (p._id.isPremium) byArtist[aid].premium += p.count;
      else                 byArtist[aid].free    += p.count;
      byArtist[aid].totalPlays += p.count;
    }

    // 3. Agréger les ventes MP3 de la période (si modèle Purchase existe)
    const purchaseByArtist = {};
    try {
      const Purchase = require('../models/Purchase');
      const purchases = await Purchase.aggregate([
        { $match: { period, status: 'completed', artisteId: { $ne: null } } },
        { $group: { _id: '$artisteId', total: { $sum: '$artistShare' } } },
      ]);
      for (const p of purchases) purchaseByArtist[String(p._id)] = p.total;
    } catch (_) {}

    // 4. Calculer et enregistrer les royalties par artiste
    let processed = 0;
    for (const [artisteId, data] of Object.entries(byArtist)) {
      // Revenus bruts en centimes
      const fromFree    = Math.round(data.free    * RATE_FREE    * 100);
      const fromPremium = Math.round(data.premium * RATE_PREMIUM * 100);
      const fromSales   = purchaseByArtist[artisteId] || 0;

      // Net après commission (les ventes ont déjà leur commission déduite)
      const netRevenue = Math.round(
        (fromFree + fromPremium) * (1 - PLATFORM_CUT) + fromSales
      );

      if (netRevenue <= 0) continue;

      // Upsert royalty
      await Royalty.findOneAndUpdate(
        { artisteId, period },
        {
          $inc: {
            plays:               data.totalPlays,
            'sources.free':      fromFree,
            'sources.premium':   fromPremium,
            'sources.purchases': fromSales,
            revenue:             netRevenue,
          },
          $setOnInsert: { status: 'pending' },
        },
        { upsert: true, new: true }
      );

      // Mettre à jour le solde de l'artiste
      await PayoutInfo.findOneAndUpdate(
        { artisteId },
        { $inc: { pendingBalance: netRevenue, totalEarned: netRevenue } },
        { upsert: true }
      );

      processed++;
    }

    // 5. Marquer toutes les écoutes comme comptabilisées
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

// ─────────────────────────────────────────────
// Démarrer le cron — 1er du mois à 02:00 UTC
// ─────────────────────────────────────────────
const startRoyaltiesCron = () => {
  cron.schedule('0 2 1 * *', async () => {
    const period = previousPeriod();
    await calculateRoyalties(period);
  }, { timezone: 'UTC' });

  console.log('[ROYALTIES] ⏰ Cron planifié — 1er du mois à 02:00 UTC');
};

module.exports = { startRoyaltiesCron, calculateRoyalties };