// Cloudflare Pages Function — /api/create-payment
//
// Crée une transaction FedaPay avec le client (nom, prénom, téléphone, email)
// déjà attaché, puis génère le lien de paiement correspondant. Comme le client
// est déjà connu de FedaPay au moment de la création du lien, l'utilisateur
// arrive directement sur l'écran de choix du moyen de paiement — sans repasser
// par l'écran "renseigne ton nom/prénom/email".
//
// IMPORTANT — configuration requise sur Cloudflare Pages :
//   Dashboard Cloudflare Pages → ton projet → Settings → Environment variables
//   → ajoute une variable "FEDAPAY_SECRET_KEY" (type "Secret") avec ta clé
//   secrète FedaPay (sk_live_...). Ne mets JAMAIS cette clé dans le code.

const FEDAPAY_API_BASE = 'https://api.fedapay.com/v1';

// Montants en FCFA, dans le même ordre que PLANS côté front (7/30/90/270 jours).
// Calculés côté serveur (jamais reçus du client) pour éviter toute manipulation.
const PLAN_AMOUNTS = {
  7: 500,
  30: 1500,
  90: 2500,
  270: 5000
};

export async function onRequestPost(context) {
  const { request, env } = context;

  const secretKey = env.FEDAPAY_SECRET_KEY;
  if (!secretKey) {
    return json({ error: 'Clé FedaPay non configurée côté serveur.' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Requête invalide.' }, 400);
  }

  const { days, firstname, lastname, phone, email, callbackUrl } = body || {};

  const amount = PLAN_AMOUNTS[days];
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
    // 1) Créer la transaction avec le client déjà attaché
    const txRes = await fetch(`${FEDAPAY_API_BASE}/transactions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${secretKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        description: `Abonnement FicheProBot - ${days} jours`,
        amount,
        currency: { iso: 'XOF' },
        ...(callbackUrl ? { callback_url: callbackUrl } : {}),
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

    // 2) Générer le lien de paiement — déjà lié au client, donc pas de re-saisie
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
