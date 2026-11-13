import { requireAdmin, json, getAppMode, getMinPlanBonus, getPlanAmounts, getDownloadPolicies, getReadyFichePrices, getFreeLimits, getTierLimits, getTierLimitsByDays, getTiersEnabled, TIER_DURATIONS, TIER_FEATURES, TIER_IDS, TIER_LABELS, getPlanQuotas, getLoginGates, LOGIN_GATE_KEYS, PLANS } from './_shared.js';
import { verifState } from './_verify.js';

/* Renvoie l'état actuel des réglages pilotés par l'onglet "Abonnements" du
   dashboard admin : mode gratuit/payant, bonus automatique à la formule
   minimale, et prix courants des abonnements. */
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);
    const [appMode, minPlanBonus, planAmounts, downloadPolicies, readyFichePrices, freeLimits, tierLimits, tierLimitsByDays, tiersEnabled, planQuotas, loginGates, vst] = await Promise.all([
      getAppMode(db),
      getMinPlanBonus(db),
      getPlanAmounts(db),
      getDownloadPolicies(db),
      getReadyFichePrices(db),
      getFreeLimits(db),
      getTierLimits(db),
      getTierLimitsByDays(db),
      getTiersEnabled(db),
      getPlanQuotas(db),
      getLoginGates(db),
      verifState(db, env)
    ]);
    return json({ ok: true, appMode, minPlanBonus, planAmounts, downloadPolicies, readyFichePrices, freeLimits, tierLimits, tierLimitsByDays, tiersEnabled, tierDurations: TIER_DURATIONS, planQuotas, loginGates, loginGateKeys: LOGIN_GATE_KEYS, planDefs: PLANS.map(p => ({ days: p.days, label: p.label, tier: p.tier, quota: p.quota })), verif: { settings: vst.settings, configured: vst.configured, effective: vst.channels, required: vst.required }, tierFeatures: TIER_FEATURES, tierIds: TIER_IDS, tierLabels: TIER_LABELS });
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}
