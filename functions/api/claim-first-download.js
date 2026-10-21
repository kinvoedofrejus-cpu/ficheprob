import {
  json, ensureDownloadTables, resolveOwner, getUsage, incUsage,
  hasResourcePurchase, addResourcePurchase, resourceGroupOf, hasFirstDownload, getResumePurchases, hasResumePurchase, addResumePurchase,
  getDownloadPolicies, hasPaidResourcePurchase,
  RESOURCE_FREE_PER_RESOURCE, RESOURCE_FREE_PER_RESOURCE_AMBASSADOR, RESUME_AMBASSADOR_FREE_CLASSES
} from './_shared.js';

/* Cloudflare Function — /api/claim-first-download   (règles du 12/10/2026)
   Body : { phone?, code?, deviceId, kind: 'resource' | 'matiere' | 'classe' | 'all', ref }
   Le compte (phone+code) est facultatif : sans compte valide, le visiteur est reconnu par son appareil.

   - 'resource' (ref = id de la ressource) : dans chaque TYPE de ressource, 1 niveau gratuit (5 pour un ambassadeur) ;
     un autre niveau = 500 F, tous les niveaux du type = 1 500 F. Sinon { ok:false, reason:'payment_required', group }.
   - 'resume'   (ref = classe::matiere::idRésumé) : résumé à l'unité — 2 résumés distincts gratuits par matière
     (re-télécharger l'un des 2 reste gratuit), à partir du 3e il faut acheter la matière (500 F).
   - 'matiere'  : déjà achetée -> ok ; sinon 1er téléchargement gratuit par matière, puis paiement (500 F).
   - 'classe'   : déjà achetée -> ok ; ambassadeur -> UNE classe gratuite (la 1re demandée, ensuite acquise
     pour toujours) ; sinon paiement (3 000 F).
   - 'all'      : déjà acheté -> ok ; sinon paiement (8 000 F), y compris pour un ambassadeur.
   Tout est vérifié et consommé côté serveur (fiable même en changeant d'appareil pour un compte). */
const RESUME_FREE_PER_MATIERE = 2;

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { phone, code, deviceId, kind, ref } = await request.json();
    const cleanRef = String(ref || '').trim();
    if (!['resource', 'matiere', 'classe', 'all', 'resume'].includes(kind) || (kind !== 'all' && !cleanRef)) {
      return json({ ok: false, reason: 'invalid' }, 400);
    }
    await ensureDownloadTables(db);
    const who = await resolveOwner(db, { phone, code, deviceId });
    if (!who.owner) return json({ ok: false, reason: 'invalid' }, 400);
    const { owner, ambassador } = who;
    // Politique admin (séparée ressources / résumés) : 'normal' | 'payant' | 'gratuit'.
    //  - 'gratuit' : tout est téléchargeable librement, sans achat ni quota.
    //  - 'payant'  : aucun téléchargement gratuit ; les comptes ambassadeurs sont EXEMPTÉS (règles normales).
    const policies = await getDownloadPolicies(db);
    const policy = kind === 'resource' ? policies.resources : policies.resumes;
    if (policy === 'gratuit') return json({ ok: true, free: true, unlimited: true, policy: 'gratuit' });
    const paidOnly = policy === 'payant' && !ambassador;

    if (kind === 'resource') {
      const group = resourceGroupOf(cleanRef);
      if (!group) return json({ ok: false, reason: 'invalid' }, 400);
      // Déjà débloquée (gratuite ou payée), ou tous les niveaux du type achetés -> téléchargement libre.
      if (paidOnly) {
        if (await hasPaidResourcePurchase(db, owner, cleanRef) || await hasPaidResourcePurchase(db, owner, 'all:' + group)) {
          return json({ ok: true, free: false, purchased: true });
        }
        return json({ ok: false, reason: 'payment_required', group, paidOnly: true });
      }
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
    const [classe, matiere] = (kind === 'matiere' || kind === 'resume') ? cleanRef.split('::') : kind === 'classe' ? [cleanRef, '*'] : ['*', '*'];
    if (hasResumePurchase(purchases, classe, matiere)) return json({ ok: true, free: false, purchased: true });

    if (kind === 'resume') {
      const resumeId = cleanRef.split('::')[2];
      if (!classe || !matiere || !resumeId) return json({ ok: false, reason: 'invalid' }, 400);
      if (paidOnly) return json({ ok: false, reason: 'payment_required', paidOnly: true });
      const mKey = classe + '::' + matiere;
      // Déjà l'un des résumés gratuits de cette matière : reste téléchargeable.
      if (await getUsage(db, owner, 'resume-one', cleanRef)) return json({ ok: true, free: true });
      const used = await getUsage(db, owner, 'resume-one-count', mKey);
      if (used < RESUME_FREE_PER_MATIERE) {
        await incUsage(db, owner, 'resume-one', cleanRef);
        await incUsage(db, owner, 'resume-one-count', mKey);
        return json({ ok: true, free: true, freeLeft: RESUME_FREE_PER_MATIERE - used - 1 });
      }
      return json({ ok: false, reason: 'payment_required', classe, matiere });
    }

    if (paidOnly) return json({ ok: false, reason: 'payment_required', paidOnly: true });

    // Ambassadeur : UNE seule classe entière gratuite. Elle est enregistrée comme achat (classe, '*') pour que
    // la classe reste téléchargeable ensuite ; toutes les autres classes, et « toutes les classes », sont payantes.
    if (ambassador && kind === 'classe') {
      const used = await getUsage(db, owner, 'resume-class-free', '*');
      if (used < RESUME_AMBASSADOR_FREE_CLASSES) {
        await incUsage(db, owner, 'resume-class-free', '*');
        await addResumePurchase(db, owner, classe, '*', 'ambassadeur-free');
        return json({ ok: true, free: true, freeLeft: RESUME_AMBASSADOR_FREE_CLASSES - used - 1 });
      }
    }
    if (kind === 'matiere') {
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
