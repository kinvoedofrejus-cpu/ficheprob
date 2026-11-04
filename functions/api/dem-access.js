import { json, normalizePhone, ensureDownloadTables, resolveOwner, hasResourcePurchase, incUsage,
  DEM_FREE_COUNT, DEM_ALL_PRICE, DEM_ALL_RESOURCE_ID } from './_shared.js';
import { OWNER_PHONE_HARDCODED, OWNER_CODE_HARDCODED } from './user-login.js';

// Cloudflare Function — /api/dem-access   (démarches pédagogiques, 05/11/2026)
//
// Body : { phone?, code?, deviceId, scope: 'one' | 'all', key?, consume? }
//  - compte propriétaire : toujours autorisé ;
//  - forfait « toutes les démarches » acheté (DEM_ALL_PRICE) : toujours autorisé ;
//  - sinon scope 'one' : DEM_FREE_COUNT démarches gratuites (re-télécharger la même reste gratuit) ; consume:true enregistre
//    la démarche demandée ; scope 'all' : paiement requis.
// Réponse : { ok:true, owner?, purchased?, free?, remaining? } ou { ok:false, reason:'payment_required', price }.
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { phone, code, deviceId, scope, key, consume } = await request.json();
    if (!['one', 'all'].includes(scope)) return json({ ok: false, reason: 'invalid' }, 400);
    const cleanKey = String(key || '').trim().slice(0, 80);
    if (scope === 'one' && !cleanKey) return json({ ok: false, reason: 'invalid' }, 400);

    const phoneDigits = normalizePhone(phone || '');
    const cleanCode = String(code || '').trim().toUpperCase();
    if (phoneDigits && phoneDigits === normalizePhone(OWNER_PHONE_HARDCODED) && cleanCode === OWNER_CODE_HARDCODED.toUpperCase()) {
      return json({ ok: true, owner: true });
    }

    await ensureDownloadTables(db);
    const who = await resolveOwner(db, { phone, code, deviceId });
    if (!who.owner) return json({ ok: false, reason: 'invalid' }, 400);
    const owner = who.owner;

    if (await hasResourcePurchase(db, owner, DEM_ALL_RESOURCE_ID)) return json({ ok: true, purchased: true });
    if (scope === 'all') return json({ ok: false, reason: 'payment_required', price: DEM_ALL_PRICE });

    const rows = await db.prepare("SELECT ref FROM download_usage WHERE owner = ? AND kind = 'demarche'").bind(owner).all();
    const used = ((rows && rows.results) || []).map(r => r.ref);
    if (used.includes(cleanKey)) return json({ ok: true, free: true, remaining: Math.max(0, DEM_FREE_COUNT - used.length) });
    if (used.length >= DEM_FREE_COUNT) return json({ ok: false, reason: 'payment_required', price: DEM_ALL_PRICE, remaining: 0 });
    if (consume) await incUsage(db, owner, 'demarche', cleanKey);
    return json({ ok: true, free: true, remaining: Math.max(0, DEM_FREE_COUNT - used.length - (consume ? 1 : 0)) });
  } catch (err) {
    return json({ error: "Erreur lors de la vérification de l'accès : " + err.message }, 500);
  }
}
