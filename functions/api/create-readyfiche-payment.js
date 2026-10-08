import {
  normalizePhone, json, getUser, upsertTx,
  READYFICHE_MATIERE_PRICE, READYFICHE_CLASSE_PRICE,
  FEDAPAY_SECRET_KEY_HARDCODED
} from './_shared.js';

// Cloudflare Function — /api/create-readyfiche-payment
//
// Crée une transaction FedaPay pour l'achat d'une "Fiche Prête" : soit une
// seule matière (tier 'matiere', READYFICHE_MATIERE_PRICE), soit toutes les
// matières d'une classe d'un coup (tier 'classe', READYFICHE_CLASSE_PRICE).
// Réserve la transaction dans D1 (type "readyfiche") AVANT de rediriger vers
// FedaPay, pour que le webhook sache quoi débloquer une fois payé.

const FEDAPAY_API_BASE = 'https://api.fedapay.com/v1';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;

  const secretKey = FEDAPAY_SECRET_KEY_HARDCODED;
  if (!secretKey) return json({ error: 'Clé FedaPay non configurée côté serveur.' }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Requête invalide.' }, 400); }

  const { phone, code, classe, matiere, firstname, lastname, email, callbackUrl } = body || {};
  const tier = body && body.tier === 'classe' ? 'classe' : 'matiere';
  const phoneDigits = normalizePhone(phone);
  const cleanCode = (code || '').trim().toUpperCase();

  if (phoneDigits.length < 8 || !cleanCode) {
    return json({ error: 'Compte invalide. Reconnecte-toi puis réessaie.' }, 401);
  }
  if (!classe) return json({ error: 'Classe requise.' }, 400);
  if (tier === 'matiere' && !matiere) return json({ error: 'Matière requise.' }, 400);

  const effMatiere = tier === 'classe' ? '*' : String(matiere);
  const amount = tier === 'classe' ? READYFICHE_CLASSE_PRICE : READYFICHE_MATIERE_PRICE;
  const description = tier === 'classe'
    ? `Fiche Prête FicheProBot - Toutes les matières (${classe})`
    : `Fiche Prête FicheProBot - ${matiere} (${classe})`;

  const userRecord = await getUser(db, phoneDigits);
  if (!userRecord || (userRecord.code || '').toUpperCase() !== cleanCode) {
    return json({ error: 'Compte invalide. Reconnecte-toi puis réessaie.' }, 401);
  }
  if (!userRecord.active || userRecord.expiryTs <= Date.now()) {
    return json({ error: 'Ton abonnement est inactif ou expiré.' }, 403);
  }

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
      type: 'readyfiche',
      status: 'pending',
      phone: phoneDigits,
      classe: String(classe),
      matiere: effMatiere,
      tier,
      amount,
      createdAt: Date.now()
    });

    return json({ url: tokenData.url, transactionId });
  } catch (err) {
    return json({ error: 'Erreur réseau vers FedaPay.' }, 500);
  }
}
