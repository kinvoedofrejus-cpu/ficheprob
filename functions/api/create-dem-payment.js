import {
  normalizePhone, json, upsertTx, ensureDownloadTables, resolveOwner,
  DEM_ALL_PRICE, DEM_ALL_RESOURCE_ID, FEDAPAY_SECRET_KEY_HARDCODED, pickCallbackUrl } from './_shared.js';

// Cloudflare Function — /api/create-dem-payment   (démarches pédagogiques, 05/11/2026)
//
// Achat du forfait « toutes les démarches » (téléchargement de toutes les démarches avec page de garde et nom de
// l'enseignant) : DEM_ALL_PRICE (1 500 F), une seule fois. Compte facultatif : sans compte, achat rattaché à l'appareil.
// Body : { phone?, code?, deviceId, payerPhone, firstname?, lastname?, email?, callbackUrl? }
// Réservé en type "resource" avec 'demarches-all' dans "matiere" : débloqué ensuite via addResourcePurchase (_pay-finalize.js).

const FEDAPAY_API_BASE = 'https://api.fedapay.com/v1';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;

  const secretKey = FEDAPAY_SECRET_KEY_HARDCODED;
  if (!secretKey) return json({ error: 'Clé FedaPay non configurée côté serveur.' }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Requête invalide.' }, 400); }

  const { phone, code, deviceId, payerPhone, firstname, lastname, email, callbackUrl } = body || {};
  await ensureDownloadTables(db);
  const who = await resolveOwner(db, { phone, code, deviceId });
  if (!who.owner) return json({ error: 'Appareil non reconnu. Recharge la page puis réessaie.' }, 400);

  const payer = normalizePhone(payerPhone || (who.account ? phone : ''));
  if (payer.length < 8) return json({ error: 'Numéro de téléphone requis pour le paiement.' }, 400);

  const rec = who.record || {};
  const customer = {
    firstname: String(firstname || rec.prenom || 'Client'),
    lastname: String(lastname || rec.nom || 'FicheProBot'),
    phone_number: { number: payer, country: 'bj' }
  };
  if (email) customer.email = String(email);
  const amount = DEM_ALL_PRICE;
  const description = 'Démarches pédagogiques FicheProBot - toutes les démarches';

  try {
    const txRes = await fetch(`${FEDAPAY_API_BASE}/transactions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        description, amount, currency: { iso: 'XOF' },
        callback_url: pickCallbackUrl(callbackUrl, request),
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
      phone: who.owner,
      classe: '-',
      matiere: DEM_ALL_RESOURCE_ID,
      tier: 'dem',
      amount,
      createdAt: Date.now()
    });

    return json({ url: tokenData.url, transactionId, amount });
  } catch (err) {
    return json({ error: 'Erreur réseau vers FedaPay.' }, 500);
  }
}
