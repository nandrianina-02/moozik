const express = require('express');
const Stripe = require('stripe');
const Subscription = require('../../models/Subscription');
const Payment = require('../../models/Payment');

const router = express.Router();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: '2024-06-20',
});

router.post('/stripe-webhook', async (req, res) => {
  try {
    const sig = req.headers['stripe-signature'];
    const event = stripe.webhooks.constructEvent(
      req.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );

    // Handle events
    if (event.type === 'checkout.session.completed') {
      const session = event.data.object;

      const userId = session.metadata?.userId;
      if (!userId) return res.status(200).json({ received: true });

      // Tu peux raffiner en récupérant subscription id si besoin
      const subscriptionId = session.subscription || '';

      // Update Subscription
      await Subscription.findOneAndUpdate(
        { userId },
        {
          $set: {
            userId,
            plan: 'premium',
            status: 'active',
            provider: 'stripe',
            providerSubscriptionId: subscriptionId,
            providerCustomerId: session.customer || '',
            activatedAt: new Date(),
          }
        },
        { upsert: true, new: true }
      );

      // Update Payment
      await Payment.updateMany(
        { providerPaymentId: session.id },
        { $set: { status: 'succeeded', providerSubscriptionId: subscriptionId } }
      );
    }

    res.json({ received: true });
  } catch (e) {
    res.status(400).json({ message: e.message });
  }
});

module.exports = router;