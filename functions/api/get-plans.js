import { json, getEffectivePlans } from './_shared.js';

/* Endpoint public (pas d'auth) — renvoie les 4 formules d'abonnement avec
   leur prix courant (éventuellement modifié par l'admin via
   admin-set-plan-prices.js). Appelé par index.html au chargement pour
   afficher les bons prix sans avoir à redéployer le code. */
export async function onRequestGet(context) {
  const { env } = context;
  try {
    const plans = await getEffectivePlans(env.FPB_DB);
    return json({ ok: true, plans });
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}
