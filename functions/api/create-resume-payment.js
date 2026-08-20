import {
  normalizePhone, json, kvKeyUser, kvGetJSON, kvSetJSON, kvKeyTx,
  RESUME_BUNDLE_PRICE, RESUME_CLASSE_BUNDLE_PRICE, RESUME_ALL_BUNDLE_PRICE,
  FEDAPAY_SECRET_KEY_HARDCODED
} from './_shared.js';

// Cloudflare Function — /api/create-resume-payment
//
// Crée une transaction FedaPay pour l'achat d'une matière complète de résumés
// (téléchargement illimité de tous les résumés d'une classe+matière), au prix fixe
// RESUME_BUNDLE_PRICE (voir _shared.js). Réserve la transaction dans KV (tx:<id>) avec
// type "resume" + classe/matiere/phone AVANT de rediriger vers FedaPay, pour que le
// webhook (functions/api/webhook.js) sache quoi débloquer une fois le paiement confirmé.

const FEDAPAY_API_BASE = 'https://api.fedapay.com/v1';

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.FPB_KV;

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

  const { phone, code, classe, matiere, firstname, lastname, email, callbackUrl } = body || {};
  // tier : 'matiere' (une matière, prix RESUME_BUNDLE_PRICE), 'classe' (toutes les matières
  // d'une classe, prix RESUME_CLASSE_BUNDLE_PRICE) ou 'all' (toutes les classes CI à CM2,
  // prix RESUME_ALL_BUNDLE_PRICE). Par défaut 'matiere' pour compatibilité.
  const tier = ['matiere', 'classe', 'all'].includes(body && body.tier) ? body.tier : 'matiere';
  const phoneDigits = normalizePhone(phone);
  const cleanCode = (code || '').trim().toUpperCase();

  if (phoneDigits.length < 8 || !cleanCode) {
    return json({ error: 'Compte invalide. Reconnecte-toi puis réessaie.' }, 401);
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

  const userRecord = await kvGetJSON(kv, kvKeyUser(phoneDigits));
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
    await kvSetJSON(kv, kvKeyTx(transactionId), {
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
