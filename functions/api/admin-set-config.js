import { requireAdmin, json, PLANS, setPlanQuotas, getPlanQuotas, setLoginGates, setVerifSettings } from './_shared.js';

/* Réglages de l'espace admin (novembre 2026) — un seul point d'entrée :
   kind 'quotas'     : value = tableau du nombre de fiches de chaque formule (même ordre que PLANS) ;
   kind 'loginGates' : value = { elaboration, integration, planification, statistiques, pointExecution, listeAlpha, expression, demarches } (true = connexion obligatoire) ;
   kind 'verif'      : value = { required, email, whatsapp } (interrupteurs ; les clés restent dans les variables Cloudflare). */
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token, kind, value } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);
    if (kind === 'quotas') {
      if (!Array.isArray(value) || value.length !== PLANS.length) return json({ error: `Fournis exactement ${PLANS.length} valeurs.` }, 400);
      await setPlanQuotas(db, value);
      return json({ ok: true, planQuotas: await getPlanQuotas(db) });
    }
    if (kind === 'loginGates') return json({ ok: true, loginGates: await setLoginGates(db, value || {}) });
    if (kind === 'verif') return json({ ok: true, verif: await setVerifSettings(db, value || {}) });
    return json({ error: 'Réglage inconnu.' }, 400);
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}
