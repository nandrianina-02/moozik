const express = require('express');
const Stripe = require('stripe');
const { requireAuth } = require('../../middlewares/auth'); // on va le créer après
const Subscription = require('../../models/Subscription');
const Payment = require('../../models/Payment');

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

// Crée une session Checkout pour Premium
router.post('/create-checkout-session', requireAuth, async (req, res) => {
  try {
    const userId = req.user.id;

    // Montant premium (à définir dans .env)
    const priceId = process.env.STRIPE_PRICE_ID; // ex: price_xxx
    if (!priceId) return res.status(500).json({ message: 'STRIPE_PRICE_ID manquant' });

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceId, quantity: 1 }],

      // Important : passe l'userId dans le metadata
      metadata: { userId: String(userId), type: 'premium' },

      success_url: `${process.env.FRONTEND_URL}/premium/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/premium/cancel`,

      automatic_tax: { enabled: false },
      payment_method_types: ['card'],
    });

    // Enregistre une trace “pending”
    await Payment.create({
      userId,
      type: 'stripe_subscription',
      provider: 'stripe',
      providerPaymentId: session.id,
      amount: 0,
      currency: process.env.STRIPE_CURRENCY || 'XOF',
      status: 'pending',
      meta: { mode: session.mode }
    });

    res.json({ url: session.url });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;