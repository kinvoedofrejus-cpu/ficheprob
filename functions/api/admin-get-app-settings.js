import { requireAdmin, json, getAppMode, getMinPlanBonus, getPlanAmounts } from './_shared.js';

/* Renvoie l'état actuel des réglages pilotés par l'onglet "Abonnements" du
   dashboard admin : mode gratuit/payant, bonus automatique à la formule
   minimale, et prix courants des abonnements. */
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);
    const [appMode, minPlanBonus, planAmounts] = await Promise.all([
      getAppMode(db),
      getMinPlanBonus(db),
      getPlanAmounts(db)
    ]);
    return json({ ok: true, appMode, minPlanBonus, planAmounts });
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}
