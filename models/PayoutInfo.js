const mongoose = require('mongoose');

const PayoutInfoSchema = new mongoose.Schema({
  artisteId:           { type: mongoose.Schema.Types.ObjectId, ref: 'Artist', unique: true },
  paypalEmail:         { type: String, default: '' },
  mobileMoneyPhone:    { type: String, default: '' },
  mobileMoneyProvider: { type: String, default: 'none' },
  stripeAccountId:     { type: String, default: '' },
  onboardingDone:      { type: Boolean, default: false },
  pendingBalance:      { type: Number,  default: 0 }, // centimes EUR non encore versés
  totalEarned:         { type: Number,  default: 0 }, // centimes EUR total historique
}, { timestamps: true });

module.exports = mongoose.model('PayoutInfo', PayoutInfoSchema);