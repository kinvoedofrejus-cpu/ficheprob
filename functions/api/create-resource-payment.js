import {
  normalizePhone, json, upsertTx, ensureDownloadTables, resolveOwner,
  RESOURCE_PRICE, RESOURCE_GROUP_PRICE, resourceGroupOf, FEDAPAY_SECRET_KEY_HARDCODED
} from './_shared.js';

// Cloudflare Function — /api/create-resource-payment   (règles du 12/10/2026)
//
// Achat d'une ressource (500 F : ce niveau) ou de tous les niveaux d'un type (1 500 F).
// Le compte est facultatif : sans compte valide, l'achat est rattaché à l'appareil du visiteur.
// Body : { phone?, code?, deviceId, resourceId, scope ('resource'|'group'), payerPhone, title?, firstname?, lastname?, email?, callbackUrl? }
// La transaction est réservée dans D1 (type "resource", owner dans "phone", resource_id ou 'all:<type>' dans "matiere")
// AVANT la redirection ; le webhook débloque ensuite la ressource.

const FEDAPAY_API_BASE = 'https://api.fedapay.com/v1';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;

  const secretKey = FEDAPAY_SECRET_KEY_HARDCODED;
  if (!secretKey) return json({ error: 'Clé FedaPay non configurée côté serveur.' }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Requête invalide.' }, 400); }

  const { phone, code, deviceId, resourceId, scope, payerPhone, title, firstname, lastname, email, callbackUrl } = body || {};
  const cleanId = String(resourceId || '').trim();
  const group = resourceGroupOf(cleanId);
  if (!group) return json({ error: 'Ressource inconnue.' }, 400);
  const wholeGroup = scope === 'group';
  const amount = wholeGroup ? RESOURCE_GROUP_PRICE : RESOURCE_PRICE;
  const unlockRef = wholeGroup ? 'all:' + group : cleanId;

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
  const description = wholeGroup
    ? `Ressources FicheProBot - tous les niveaux (${group})`
    : `Ressource FicheProBot - ${String(title || cleanId).slice(0, 120)}`;

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
      phone: who.owner,
      classe: '-',
      matiere: unlockRef,
      tier: wholeGroup ? 'group' : 'resource',
      amount,
      createdAt: Date.now()
    });

    return json({ url: tokenData.url, transactionId, amount });
  } catch (err) {
    return json({ error: 'Erreur réseau vers FedaPay.' }, 500);
  }
}
