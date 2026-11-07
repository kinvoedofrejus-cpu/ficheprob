import { json, getEffectivePlans, getTierLimits, getLoginGates, TIER_FEATURES, TIER_LABELS } from './_shared.js';

/* Endpoint public (pas d'auth) — renvoie les 4 formules d'abonnement avec
   leur prix courant (éventuellement modifié par l'admin via
   admin-set-plan-prices.js). Appelé par index.html au chargement pour
   afficher les bons prix sans avoir à redéployer le code. */
export async function onRequestGet(context) {
  const { env } = context;
  try {
    const plans = await getEffectivePlans(env.FPB_DB);
    const tierLimits = await getTierLimits(env.FPB_DB);
    const loginGates = await getLoginGates(env.FPB_DB);
    return json({ ok: true, plans, tierLimits, loginGates, tierFeatures: TIER_FEATURES, tierLabels: TIER_LABELS });
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}
