import {
  normalizePhone, json, upsertTx, ensureDownloadTables, resolveOwner,
  RESUME_BUNDLE_PRICE, RESUME_CLASSE_BUNDLE_PRICE, RESUME_ALL_BUNDLE_PRICE,
  FEDAPAY_SECRET_KEY_HARDCODED, pickCallbackUrl } from './_shared.js';

// Cloudflare Function — /api/create-resume-payment
//
// Crée une transaction FedaPay pour l'achat d'une matière complète de résumés
// (téléchargement illimité de tous les résumés d'une classe+matière), au prix fixe
// RESUME_BUNDLE_PRICE (voir _shared.js). Réserve la transaction dans D1 (table
// transactions) avec type "resume" + classe/matiere/phone AVANT de rediriger vers
// FedaPay, pour que le webhook (functions/api/webhook.js) sache quoi débloquer une
// fois le paiement confirmé.

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

  const { phone, code, deviceId, payerPhone, classe, matiere, firstname, lastname, email, callbackUrl } = body || {};
  // tier : 'matiere' (une matière, prix RESUME_BUNDLE_PRICE), 'classe' (toutes les matières
  // d'une classe, prix RESUME_CLASSE_BUNDLE_PRICE) ou 'all' (toutes les classes CI à CM2,
  // prix RESUME_ALL_BUNDLE_PRICE). Par défaut 'matiere' pour compatibilité.
  const tier = ['matiere', 'classe', 'all'].includes(body && body.tier) ? body.tier : 'matiere';
  // Compte facultatif (règles du 12/10/2026) : sans compte valide, l'achat est rattaché à l'appareil du visiteur.
  await ensureDownloadTables(db);
  const who = await resolveOwner(db, { phone, code, deviceId });
  if (!who.owner) {
    return json({ error: 'Appareil non reconnu. Recharge la page puis réessaie.' }, 400);
  }
  const phoneDigits = who.owner;                      // owner stocké dans la réservation
  const payer = normalizePhone(payerPhone || (who.account ? phone : ''));
  if (payer.length < 8) {
    return json({ error: 'Numéro de téléphone requis pour le paiement.' }, 400);
  }

  if (tier === 'matiere' && (!classe || !matiere)) {
    return json({ error: 'Classe et matière requises.' }, 400);
  }
  if (tier === 'classe' && !classe) {
    return json({ error: 'Classe requise.' }, 400);
  }

  // Valeurs effectives stockées : '*' est un joker (voir hasResumePurchase dans _shared.js)
  const effClasse = tier === 'all' ? '*' : String(classe);
  const effMatiere = tier === 'matiere' ? String(matiere) : '*';
  const amount = tier === 'all' ? RESUME_ALL_BUNDLE_PRICE
    : tier === 'classe' ? RESUME_CLASSE_BUNDLE_PRICE
    : RESUME_BUNDLE_PRICE;
  const description = tier === 'all'
    ? 'Résumés FicheProBot - Toutes les classes (CI à CM2)'
    : tier === 'classe'
    ? `Résumés FicheProBot - Toutes les matières (${classe})`
    : `Résumés FicheProBot - ${matiere} (${classe})`;

  const userRecord = who.record || {};

  const customer = {
    firstname: String(firstname || userRecord.prenom || 'Client'),
    lastname: String(lastname || userRecord.nom || 'FicheProBot'),
    phone_number: { number: payer, country: 'bj' }
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
        description,
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

    // 2) Générer le lien de paiement
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

    // 3) Réserver la transaction AVANT redirection, pour que le webhook sache quelle
    //    matière débloquer une fois le paiement confirmé.
    await upsertTx(db, transactionId, {
      type: 'resume',
      status: 'pending',
      phone: phoneDigits,
      classe: effClasse,
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
