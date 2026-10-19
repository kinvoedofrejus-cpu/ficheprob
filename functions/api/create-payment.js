// Cloudflare Pages Function — /api/create-payment
//
// Crée une transaction FedaPay avec le client (nom, prénom, téléphone, email)
// déjà attaché, puis génère le lien de paiement correspondant.

import { FEDAPAY_SECRET_KEY_HARDCODED, PLANS, planIndexFor, getPlanAmounts, pickCallbackUrl, upsertTx, normalizePhone } from './_shared.js';

const FEDAPAY_API_BASE = 'https://api.fedapay.com/v1';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;

  const secretKey = FEDAPAY_SECRET_KEY_HARDCODED;
  if (!secretKey) {
    return json({ error: 'Clé FedaPay non configurée côté serveur.' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Requête invalide.' }, 400);
  }

  const { days, tier, firstname, lastname, phone, email, callbackUrl } = body || {};

  // Montant calculé côté serveur à partir de la formule (jamais reçu du
  // client, pour éviter toute manipulation) — prix courants éventuellement
  // modifiés depuis l'onglet "Abonnements" du dashboard admin.
  const planIndex = planIndexFor(days, tier);
  if (planIndex === -1) {
    return json({ error: 'Formule inconnue.' }, 400);
  }
  const amounts = await getPlanAmounts(db);
  const amount = amounts[planIndex];
  if (!amount) {
    return json({ error: 'Formule inconnue.' }, 400);
  }
  if (!firstname || !lastname || !phone) {
    return json({ error: 'Nom, prénom et téléphone requis.' }, 400);
  }

  const customer = {
    firstname: String(firstname),
    lastname: String(lastname),
    phone_number: { number: String(phone), country: 'bj' }
  };
  if (email) customer.email = String(email);

  try {
    const txRes = await fetch(`${FEDAPAY_API_BASE}/transactions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        description: `Abonnement FicheProBot${PLANS[planIndex].tier === 'assiste' ? ' Assisté' : ' Manuel'} - ${days} jours`,
        amount,
        currency: { iso: 'XOF' },
        callback_url: pickCallbackUrl(callbackUrl, request),
        customer
      })
    });

    const txData = await txRes.json();
    if (!txRes.ok) {
      return json({ error: txData.message || 'Erreur lors de la création de la transaction.' }, 502);
    }
    const transactionId = (txData['v1/transaction'] && txData['v1/transaction'].id) || txData.id;
    if (!transactionId) {
      return json({ error: 'Identifiant de transaction introuvable.' }, 502);
    }

    const tokenRes = await fetch(`${FEDAPAY_API_BASE}/transactions/${transactionId}/token`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/json'
      }
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.url) {
      return json({ error: tokenData.message || 'Erreur lors de la génération du lien de paiement.' }, 502);
    }

    // Réservation AVANT la redirection : le webhook (ou la vérification active de /api/payment-status) retrouve ainsi
    // la formule et le compte même si le prix a été modifié depuis, et l'application peut suivre le paiement tout de suite.
    try {
      await upsertTx(db, transactionId, {
        type: 'subscription', status: 'pending', planIndex, phone: normalizePhone(phone),
        nom: String(lastname), prenom: String(firstname), amount, createdAt: Date.now()
      });
    } catch (e) { /* le webhook sait aussi retrouver la formule par le montant */ }

    return json({ url: tokenData.url, transactionId });
  } catch (err) {
    return json({ error: 'Erreur réseau vers FedaPay.' }, 500);
  }
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}
