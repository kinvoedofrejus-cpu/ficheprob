import { requireAdmin, json, setPlanAmounts, PLANS } from './_shared.js';

/* Modifie les prix (FCFA) des 4 formules d'abonnement, sans toucher à leur
   durée ni à leur quota de fiches. Lu par create-payment.js (facturation
   FedaPay) et par get-plans.js (affichage des prix côté front). */
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token, amounts } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);
    if (!Array.isArray(amounts) || amounts.length !== PLANS.length) {
      return json({ error: `Fournis exactement ${PLANS.length} montants.` }, 400);
    }
    await setPlanAmounts(db, amounts);
    return json({ ok: true, amounts: amounts.map(a => Math.max(0, parseInt(a, 10) || 0)) });
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}
