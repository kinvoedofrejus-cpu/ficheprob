import { requireAdmin, json, setMinPlanBonus } from './_shared.js';

/* Réglage permanent : nombre de fiches offertes en plus du quota normal,
   automatiquement, à chaque nouvelle souscription de la formule la moins
   chère (PLANS[MIN_PLAN_INDEX] — "7 jours"). Appliqué dans webhook.js au
   moment de la confirmation du paiement. 0 = désactivé. */
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token, bonus } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);
    await setMinPlanBonus(db, bonus);
    return json({ ok: true, bonus: Math.max(0, parseInt(bonus, 10) || 0) });
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}
