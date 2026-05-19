// utils/mailer.js
const Brevo = require('@getbrevo/brevo');

const client = Brevo.ApiClient.instance;
client.authentications['api-key'].apiKey = process.env.BREVO_API_KEY;

const api = new Brevo.TransactionalEmailsApi();

exports.sendMail = async ({ to, subject, html }) => {
  await api.sendTransacEmail({
    sender:   { email: 'onboarding@resend.dev', name: 'Moozik' },
    to:       [{ email: to }],
    subject,
    htmlContent: html,
  });
};