import {
  normalizePhone, json, getUser, upsertTx,
  getReadyFichePrices, readyFichePriceFor, READYFICHE_CLASSE_PRICE_WORD,
  FEDAPAY_SECRET_KEY_HARDCODED, hashGuestToken, pickCallbackUrl } from './_shared.js';

// Cloudflare Function — /api/create-readyfiche-payment
//
// Crée une transaction FedaPay pour l'achat d'une "Fiche Prête" : soit une
// seule matière (tier 'matiere', READYFICHE_MATIERE_PRICE), soit toutes les
// matières d'une classe d'un coup (tier 'classe', READYFICHE_CLASSE_PRICE).
// Réserve la transaction dans D1 (type "readyfiche") AVANT de rediriger vers
// FedaPay, pour que le webhook sache quoi débloquer une fois payé.

const FEDAPAY_API_BASE = 'https://api.fedapay.com/v1';
const READYFICHE_CLASSE_PRICE = 5200;   // FCFA — toutes les matières d'une classe, même prix pour toutes les classes (18/10/2026)

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;

  const secretKey = FEDAPAY_SECRET_KEY_HARDCODED;
  if (!secretKey) return json({ error: 'Clé FedaPay non configurée côté serveur.' }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Requête invalide.' }, 400); }

  const { phone, code, classe, matiere, firstname, lastname, email, callbackUrl, guest, guestToken } = body || {};
  // Achat SANS compte (14/10/2026) : identifié par un jeton secret généré sur l'appareil de l'acheteur.
  const isGuest = guest === true;
  if (isGuest && (typeof guestToken !== 'string' || guestToken.length < 16 || guestToken.length > 128)) {
    return json({ error: 'Requête invalide.' }, 400);
  }
  // Forfait « toute la classe » rétabli le 18/10/2026 : 5 200 F (READYFICHE_CLASSE_PRICE), même prix pour toutes les classes.
  const tier = body && body.tier === 'classe' ? 'classe' : 'matiere';
  // Format du forfait classe (28/10/2026) : PDF 5 200 F ou Word 8 300 F. Sans effet sur l'achat d'une seule matière.
  const wantWord = tier === 'classe' && body && body.format === 'word';
  if (wantWord) {
    const l = await env.FPB_IMAGES.list({ prefix: 'readyfiche-docx/' + String(classe) + '/', limit: 1 });
    if (!(l.objects || []).length) return json({ error: "Le format Word n'est pas encore disponible pour cette classe." }, 400);
  }
  const phoneDigits = normalizePhone(phone);
  const cleanCode = (code || '').trim().toUpperCase();

  if (!isGuest && (phoneDigits.length < 8 || !cleanCode)) {
    return json({ error: 'Compte invalide. Reconnecte-toi puis réessaie.' }, 401);
  }
  if (!classe) return json({ error: 'Classe requise.' }, 400);
  if (tier === 'matiere' && (!matiere || String(matiere) === '*')) return json({ error: 'Matière requise.' }, 400);

  const effMatiere = tier === 'classe' ? '*' : String(matiere);
  const amount = tier === 'classe' ? (wantWord ? READYFICHE_CLASSE_PRICE_WORD : READYFICHE_CLASSE_PRICE) : readyFichePriceFor(await getReadyFichePrices(db), classe, effMatiere);
  // Matière rendue gratuite par l'admin : aucun paiement, accès direct.
  if (amount <= 0) return json({ free: true });
  const description = tier === 'classe'
    ? `Fiche Prête FicheProBot - Toutes les matières (${classe})${wantWord ? ' - Word' : ''}`
    : `Fiche Prête FicheProBot - ${matiere} (${classe})`;

  let userRecord = null;
  if (!isGuest) {
    userRecord = await getUser(db, phoneDigits);
    if (!userRecord || (userRecord.code || '').toUpperCase() !== cleanCode) {
      return json({ error: 'Compte invalide. Reconnecte-toi puis réessaie.' }, 401);
    }
    if (!userRecord.active || userRecord.expiryTs <= Date.now()) {
      return json({ error: 'Ton abonnement est inactif ou expiré.' }, 403);
    }
  }

  const customer = {
    firstname: String(firstname || (userRecord && userRecord.prenom) || 'Client').slice(0, 60),
    lastname: String(lastname || (userRecord && userRecord.nom) || 'FicheProBot').slice(0, 60)
  };
  if (!isGuest) customer.phone_number = { number: phoneDigits, country: 'bj' };
  if (email) customer.email = String(email);

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
      type: 'readyfiche',
      source: wantWord ? 'word' : null,
      status: 'pending',
      phone: isGuest ? null : phoneDigits,
      code: isGuest ? await hashGuestToken(guestToken) : null,
      classe: String(classe),
      matiere: effMatiere,
      tier: isGuest ? 'guest' : tier,
      amount,
      createdAt: Date.now()
    });

    return json({ url: tokenData.url, transactionId });
  } catch (err) {
    return json({ error: 'Erreur réseau vers FedaPay.' }, 500);
  }
}
