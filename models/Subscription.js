
const mongoose = require('mongoose');

const SubscriptionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', unique: true, index: true },
  plan: { type: String, enum: ['free', 'premium'], default: 'free' },
  status: { type: String, enum: ['active', 'inactive', 'canceled', 'past_due'], default: 'inactive' },

  provider: { type: String, default: 'stripe' }, // stripe | momo
  providerCustomerId: { type: String, default: '' },
  providerSubscriptionId: { type: String, default: '' },

  currentPeriodStart: { type: Date },
  currentPeriodEnd: { type: Date },

  activatedAt: { type: Date },
  canceledAt: { type: Date }
}, { timestamps: true });

module.exports = mongoose.model('Subscription', SubscriptionSchema);