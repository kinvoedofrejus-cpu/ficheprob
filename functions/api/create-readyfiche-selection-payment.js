import { json, upsertTx, hashGuestToken, pickCallbackUrl, FEDAPAY_SECRET_KEY_HARDCODED } from './_shared.js';
import { selPrice, ensureSelTable, SEL_MAX_ITEMS } from './_readyfiche-sel.js';

// Cloudflare Function — /api/create-readyfiche-selection-payment
//
// Paiement d'un « regroupement » : N titres choisis parmi les fiches prêtes, 325 F par lot de 25 (voir _readyfiche-sel.js).
// Le prix est TOUJOURS recalculé ici (jamais pris du client). Les fiches choisies sont vérifiées contre l'index des titres
// (readyfiche-pdfs/{classe}/{matiere}.titles.json) puis rangées avec le nom à imprimer. Le propriétaire ne passe pas par ici.
const FEDAPAY_API_BASE = 'https://api.fedapay.com/v1';
const SAFE = /^[A-Za-z0-9_-]{1,60}$/;

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  const secretKey = FEDAPAY_SECRET_KEY_HARDCODED;
  if (!secretKey) return json({ error: 'Clé FedaPay non configurée côté serveur.' }, 500);

  let body;
  try { body = await request.json(); } catch { return json({ error: 'Requête invalide.' }, 400); }
  const { classe, items, name, guestToken, firstname, lastname, callbackUrl } = body || {};
  if (typeof guestToken !== 'string' || guestToken.length < 16 || guestToken.length > 128) return json({ error: 'Requête invalide.' }, 400);
  if (!SAFE.test(String(classe || ''))) return json({ error: 'Classe requise.' }, 400);
  const cleanName = String(name || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (cleanName.length < 2) return json({ error: "Le nom à mettre sur la fiche est obligatoire." }, 400);
  if (!Array.isArray(items) || !items.length || items.length > SEL_MAX_ITEMS) return json({ error: 'Aucune fiche choisie.' }, 400);

  // Dédoublonnage + validation
  const seen = new Set(), clean = [];
  for (const it of items) {
    const m = String(it && it.m || ''), i = Number(it && it.i);
    if (!SAFE.test(m) || !Number.isInteger(i) || i < 0 || i > 5000) return json({ error: 'Sélection invalide.' }, 400);
    const k = m + ':' + i;
    if (!seen.has(k)) { seen.add(k); clean.push({ m, i }); }
  }
  // Chaque fiche doit exister dans l'index des titres de sa matière
  const counts = {};
  for (const m of new Set(clean.map(x => x.m))) {
    const obj = await env.FPB_IMAGES.get(`readyfiche-pdfs/${classe}/${m}.titles.json`);
    if (!obj) return json({ error: "Le regroupement n'est pas encore disponible pour une des matières choisies." }, 400);
    try { counts[m] = ((await obj.json()).titles || []).length; } catch (e) { return json({ error: 'Index des titres illisible.' }, 500); }
  }
  if (clean.some(x => x.i >= counts[x.m])) return json({ error: 'Sélection obsolète : rechargez la page et recommencez.' }, 409);

  const amount = selPrice(clean.length);
  const description = `Fiches choisies FicheProBot - ${clean.length} fiche${clean.length > 1 ? 's' : ''} (${classe})`;
  const customer = {
    firstname: String(firstname || 'Client').slice(0, 60),
    lastname: String(lastname || 'FicheProBot').slice(0, 60)
  };

  try {
    const txRes = await fetch(`${FEDAPAY_API_BASE}/transactions`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${secretKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ description, amount, currency: { iso: 'XOF' }, callback_url: pickCallbackUrl(callbackUrl, request), customer })
    });
    const txData = await txRes.json();
    if (!txRes.ok) return json({ error: txData.message || 'Erreur lors de la création de la transaction.' }, 502);
    const transactionId = (txData['v1/transaction'] && txData['v1/transaction'].id) || txData.id;
    if (!transactionId) return json({ error: 'Identifiant de transaction introuvable.' }, 502);

    const tokenRes = await fetch(`${FEDAPAY_API_BASE}/transactions/${transactionId}/token`, {
      method: 'POST', headers: { 'Authorization': `Bearer ${secretKey}`, 'Content-Type': 'application/json' }
    });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok || !tokenData.url) return json({ error: tokenData.message || 'Erreur lors de la génération du lien de paiement.' }, 502);

    await upsertTx(db, transactionId, {
      type: 'readyfichesel', status: 'pending', phone: null, code: await hashGuestToken(guestToken),
      classe: String(classe), matiere: 'sel', tier: 'guest', amount, createdAt: Date.now()
    });
    await ensureSelTable(db);
    await db.prepare('INSERT OR REPLACE INTO readyfiche_selections (tx_id, classe, items, name, n, downloads, created_at) VALUES (?,?,?,?,?,0,?)')
      .bind(String(transactionId), String(classe), JSON.stringify(clean), cleanName, clean.length, Date.now()).run();

    return json({ url: tokenData.url, transactionId, amount, n: clean.length });
  } catch (err) {
    return json({ error: 'Erreur réseau vers FedaPay.' }, 500);
  }
}
