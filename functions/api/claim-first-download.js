import {
  json, ensureDownloadTables, resolveOwner, getUsage, incUsage,
  hasResourcePurchase, addResourcePurchase, resourceGroupOf, hasFirstDownload, getResumePurchases, hasResumePurchase,
  RESOURCE_FREE_PER_RESOURCE, RESOURCE_FREE_PER_RESOURCE_AMBASSADOR, RESUME_AMBASSADOR_FREE_EXPORTS
} from './_shared.js';

/* Cloudflare Function — /api/claim-first-download   (règles du 12/10/2026)
   Body : { phone?, code?, deviceId, kind: 'resource' | 'matiere' | 'classe' | 'all', ref }
   Le compte (phone+code) est facultatif : sans compte valide, le visiteur est reconnu par son appareil.

   - 'resource' (ref = id de la ressource) : dans chaque TYPE de ressource, 1 niveau gratuit (5 pour un ambassadeur) ;
     un autre niveau = 500 F, tous les niveaux du type = 1 500 F. Sinon { ok:false, reason:'payment_required', group }.
   - 'matiere'  : déjà achetée -> ok ; ambassadeur -> 5 exports gratuits au total ; sinon 1er téléchargement
     gratuit par matière, puis paiement.
   - 'classe' / 'all' : déjà achetés -> ok ; ambassadeur -> 5 exports gratuits au total ; sinon paiement.
   Tout est vérifié et consommé côté serveur (fiable même en changeant d'appareil pour un compte). */
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { phone, code, deviceId, kind, ref } = await request.json();
    const cleanRef = String(ref || '').trim();
    if (!['resource', 'matiere', 'classe', 'all'].includes(kind) || (kind !== 'all' && !cleanRef)) {
      return json({ ok: false, reason: 'invalid' }, 400);
    }
    await ensureDownloadTables(db);
    const who = await resolveOwner(db, { phone, code, deviceId });
    if (!who.owner) return json({ ok: false, reason: 'invalid' }, 400);
    const { owner, ambassador } = who;

    if (kind === 'resource') {
      const group = resourceGroupOf(cleanRef);
      if (!group) return json({ ok: false, reason: 'invalid' }, 400);
      // Déjà débloquée (gratuite ou payée), ou tous les niveaux du type achetés -> téléchargement libre.
      if (await hasResourcePurchase(db, owner, cleanRef) || await hasResourcePurchase(db, owner, 'all:' + group)) {
        return json({ ok: true, free: false, purchased: true });
      }
      const allowance = ambassador ? RESOURCE_FREE_PER_RESOURCE_AMBASSADOR : RESOURCE_FREE_PER_RESOURCE;
      let used = await getUsage(db, owner, 'rgroup', group);
      if (used < allowance) {
        await incUsage(db, owner, 'rgroup', group);
        await addResourcePurchase(db, owner, cleanRef, 'free');   // ce niveau reste téléchargeable
        return json({ ok: true, free: true, freeLeft: allowance - used - 1 });
      }
      return json({ ok: false, reason: 'payment_required', group });
    }

    // Résumés groupés
    const purchases = await getResumePurchases(db, owner);
    const [classe, matiere] = kind === 'matiere' ? cleanRef.split('::') : kind === 'classe' ? [cleanRef, '*'] : ['*', '*'];
    if (hasResumePurchase(purchases, classe, matiere)) return json({ ok: true, free: false, purchased: true });

    if (ambassador) {
      const used = await getUsage(db, owner, 'resume-export', '*');
      if (used < RESUME_AMBASSADOR_FREE_EXPORTS) {
        await incUsage(db, owner, 'resume-export', '*');
        return json({ ok: true, free: true, freeLeft: RESUME_AMBASSADOR_FREE_EXPORTS - used - 1 });
      }
    }
    if (kind === 'matiere' && !ambassador) {
      if (!(await getUsage(db, owner, 'matiere', cleanRef)) && !(await hasFirstDownload(db, owner, 'matiere', cleanRef))) {
        await incUsage(db, owner, 'matiere', cleanRef);
        return json({ ok: true, free: true });
      }
    }
    return json({ ok: false, reason: 'payment_required' });
  } catch (err) {
    return json({ error: 'Erreur lors de la vérification du téléchargement : ' + err.message }, 500);
  }
}
