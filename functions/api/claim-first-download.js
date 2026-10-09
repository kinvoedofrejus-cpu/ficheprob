import {
  normalizePhone, json, getUser,
  hasFirstDownload, addFirstDownload, hasResourcePurchase
} from './_shared.js';

/* Cloudflare Function — /api/claim-first-download
   Le 1er téléchargement est offert, le paiement n'est demandé qu'à partir du 2e.
   Body : { phone, code, kind: 'matiere' | 'resource', ref }
   - 'resource' déjà achetée            -> { ok:true, free:false, purchased:true }
   - 1er téléchargement (jamais fait)   -> consommé ici, { ok:true, free:true }
   - déjà fait et non acheté            -> { ok:false, reason:'payment_required' }
   La vérification et la consommation se font côté serveur (fiable même en
   changeant d'appareil). */
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { phone, code, kind, ref } = await request.json();
    const phoneDigits = normalizePhone(phone);
    const cleanCode = (code || '').trim().toUpperCase();
    const cleanRef = String(ref || '').trim();
    if (phoneDigits.length < 8 || !cleanCode || !cleanRef || !['matiere', 'resource'].includes(kind)) {
      return json({ ok: false, reason: 'invalid' }, 400);
    }

    const record = await getUser(db, phoneDigits);
    if (!record || (record.code || '').toUpperCase() !== cleanCode) {
      return json({ ok: false, reason: 'invalid' }, 401);
    }
    if (!record.active) return json({ ok: false, reason: 'inactive' }, 403);
    if (record.expiryTs <= Date.now()) return json({ ok: false, reason: 'expired' }, 403);

    if (kind === 'resource' && await hasResourcePurchase(db, phoneDigits, cleanRef)) {
      return json({ ok: true, free: false, purchased: true });
    }

    if (await hasFirstDownload(db, phoneDigits, kind, cleanRef)) {
      return json({ ok: false, reason: 'payment_required' });
    }

    await addFirstDownload(db, phoneDigits, kind, cleanRef);
    return json({ ok: true, free: true });
  } catch (err) {
    return json({ error: 'Erreur lors de la vérification du téléchargement : ' + err.message }, 500);
  }
}
