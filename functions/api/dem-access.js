import { json, normalizePhone, ensureDownloadTables, resolveOwner, hasResourcePurchase, incUsage,
  DEM_FREE_COUNT, DEM_ALL_PRICE, DEM_ALL_RESOURCE_ID,
  getTierLimits, getTierLimitsByDays, tierLimitFor, getTierDemUsed, tierDemKind, tierOfUser, TIER_LABELS } from './_shared.js';
import { OWNER_PHONE_HARDCODED, OWNER_CODE_HARDCODED } from './user-login.js';

// Cloudflare Function — /api/dem-access   (démarches pédagogiques, 05/11/2026)
//
// Body : { phone?, code?, deviceId, scope: 'one' | 'all', key?, consume? }
//  - compte propriétaire : toujours autorisé ;
//  - forfait « toutes les démarches » acheté (DEM_ALL_PRICE) : toujours autorisé ;
//  - compte connecté (novembre 2026, niveaux de compte) : le TÉLÉCHARGEMENT est réglé par l'admin selon le niveau et la durée
//    (fonctionnalité « demarchesDl » = nombre de démarches différentes téléchargeables pendant la validité de l'abonnement) :
//    -1 illimité (aussi pour « toutes les démarches »), 0 non inclus (reason 'not_in_tier'), n = n démarches (re-télécharger
//    la même ne coûte rien). Au-delà, ou pour « toutes » sans accès illimité : le forfait DEM_ALL_PRICE reste possible ;
//  - visiteur sans compte (appareil seul) : ancien système ci-dessous.
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
    // Compte connecté : accès réglé par niveau + durée (voir _shared.js : tierLimitFor).
    if (who.account && who.record) {
      const limits = await getTierLimits(db);
      const byDays = await getTierLimitsByDays(db);
      const lim = tierLimitFor(limits, who.record, 'demarchesDl', byDays);
      const tier = tierOfUser(who.record);
      if (lim < 0) return json({ ok: true, unlimited: true, limit: -1, tier, tierLabel: TIER_LABELS[tier] });
      if (lim === 0) return json({ ok: false, reason: 'not_in_tier', limit: 0, tier, tierLabel: TIER_LABELS[tier] });
      if (scope === 'all') return json({ ok: false, reason: 'payment_required', price: DEM_ALL_PRICE, limit: lim, tier, tierLabel: TIER_LABELS[tier] });
      const done = await getTierDemUsed(db, owner, who.record);
      if (done.includes(cleanKey)) return json({ ok: true, free: true, tier: true, limit: lim, used: done.length, remaining: Math.max(0, lim - done.length) });
      if (done.length >= lim) return json({ ok: false, reason: 'payment_required', limitReached: true, price: DEM_ALL_PRICE, limit: lim, used: done.length, remaining: 0, tier, tierLabel: TIER_LABELS[tier] });
      if (consume) await incUsage(db, owner, tierDemKind(who.record), cleanKey);
      const usedNow = done.length + (consume ? 1 : 0);
      return json({ ok: true, free: true, tier: true, limit: lim, used: usedNow, remaining: Math.max(0, lim - usedNow) });
    }

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
