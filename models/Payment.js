// backend/models/Payment.js
const mongoose = require('mongoose');

const PaymentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', index: true },
  type: { type: String, enum: ['stripe_subscription', 'momo_tip', 'momo_ticket'], index: true },

  provider: { type: String, default: 'stripe' }, // stripe | mvola | airtel | orange
  providerPaymentId: { type: String, default: '' }, // checkout session id / transaction id
  providerCustomerId: { type: String, default: '' },
  providerSubscriptionId: { type: String, default: '' },

  amount: { type: Number, default: 0 }, // en unités monétaires (ex: X FCFA)
  currency: { type: String, default: 'XOF' },

  status: { type: String, enum: ['pending', 'succeeded', 'failed'], default: 'pending' },

  meta: { type: Object, default: {} }
}, { timestamps: true });

module.exports = mongoose.model('Payment', PaymentSchema);