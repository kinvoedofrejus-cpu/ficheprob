import { PLANS, json, getPromoList, findActivePromo } from './_shared.js';

/* Endpoint public (pas d'auth) — renvoie la promo actuellement active, s'il y en a une.
   Route enregistrée à la fois sous /api/get-promo et /api/promo-status (voir promo-status.js
   et worker.js) car le front-end (index.html) appelle /api/promo-status. */
export async function onRequestGet(context) {
  const { env } = context;
  const kv = env.FPB_KV;
  try {
    const list = await getPromoList(kv);
    const active = findActivePromo(list);

    const promo = active
      ? {
          active: true,
          freePlanIndex: active.planIndex,
          planLabel: PLANS[active.planIndex] ? PLANS[active.planIndex].label : '',
          message: active.message || '',
          endAt: active.endAt || null
        }
      : { active: false, freePlanIndex: null, message: '' };

    return json({ ok: true, promo });
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}
