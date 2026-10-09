import {
  normalizePhone, json, getUser, upsertTx,
  RESOURCE_PRICE, FEDAPAY_SECRET_KEY_HARDCODED
} from './_shared.js';

// Cloudflare Function — /api/create-resource-payment
//
// Crée une transaction FedaPay pour débloquer UNE ressource didactique
// (à partir de son 2e téléchargement). Réserve la transaction dans D1
// (type "resource", l'id de la ressource est stocké dans "matiere") AVANT de
// rediriger vers FedaPay, pour que le webhook sache quoi débloquer.

const FEDAPAY_API_BASE = 'https://api.fedapay.com/v1';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;

  const secretKey = FEDAPAY_SECRET_KEY_HARDCODED;
  if (!secretKey) return json({ error: 'Clé FedaPay non configurée côté serveur.' }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Requête invalide.' }, 400); }

  const { phone, code, resourceId, title, firstname, lastname, email, callbackUrl } = body || {};
  const phoneDigits = normalizePhone(phone);
  const cleanCode = (code || '').trim().toUpperCase();
  const cleanId = String(resourceId || '').trim();

  if (phoneDigits.length < 8 || !cleanCode) {
    return json({ error: 'Compte invalide. Reconnecte-toi puis réessaie.' }, 401);
  }
  if (!cleanId) return json({ error: 'Ressource requise.' }, 400);

  const userRecord = await getUser(db, phoneDigits);
  if (!userRecord || (userRecord.code || '').toUpperCase() !== cleanCode) {
    return json({ error: 'Compte invalide. Reconnecte-toi puis réessaie.' }, 401);
  }
  if (!userRecord.active || userRecord.expiryTs <= Date.now()) {
    return json({ error: 'Ton abonnement est inactif ou expiré.' }, 403);
  }

  const amount = RESOURCE_PRICE;
  const description = `Ressource FicheProBot - ${String(title || cleanId).slice(0, 120)}`;
  const customer = {
    firstname: String(firstname || userRecord.prenom || 'Client'),
    lastname: String(lastname || userRecord.nom || 'FicheProBot'),
    phone_number: { number: phoneDigits, country: 'bj' }
  };
  if (email) customer.email = String(email);

  try {
    const txRes = await fetch(`${FEDAPAY_API_BASE}/transactions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description, amount, currency: { iso: 'XOF' },
        ...(callbackUrl ? { callback_url: callbackUrl } : {}),
        customer
      })
    });
    const txData = await txRes.json();
    if (!txRes.ok) return json({ error: txData.message || 'Erreur lors de la création de la transaction.' }, 502);
    const transactionId = (txData['v1/transaction'] && txData['v1/transaction'].id) || txData.id;
    if (!transactionId) return json({ error: 'Identifiant de transaction introuvable.' }, 502);

    const tokenRes = await fetch(`${FEDAPAY_API_BASE}/transactions/${transactionId}/token`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${secretKey}`, 'Content-Type': 'application/json' }
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.url) return json({ error: tokenData.message || 'Erreur lors de la génération du lien de paiement.' }, 502);

    await upsertTx(db, transactionId, {
      type: 'resource',
      status: 'pending',
      phone: phoneDigits,
      classe: '-',
      matiere: cleanId,
      tier: 'resource',
      amount,
      createdAt: Date.now()
    });

    return json({ url: tokenData.url, transactionId });
  } catch (err) {
    return json({ error: 'Erreur réseau vers FedaPay.' }, 500);
  }
}
