import { requireAdmin, json, setAppMode } from './_shared.js';

/* Active/désactive le mode gratuit global.
   - { mode:'gratuit', until?: timestamp }  -> stoppe l'obligation d'abonnement
     pour tout le monde, jusqu'à relance manuelle ou jusqu'à "until" si fourni.
   - { mode:'payant' }                      -> "Relancer les abonnements" :
     retour immédiat au fonctionnement normal. */
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token, mode, until } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);
    if (mode !== 'gratuit' && mode !== 'payant') {
      return json({ error: "Mode invalide (attendu 'gratuit' ou 'payant')." }, 400);
    }
    const untilTs = (mode === 'gratuit' && until) ? Number(until) : null;
    if (mode === 'gratuit' && until && (!untilTs || Number.isNaN(untilTs))) {
      return json({ error: 'Date de fin invalide.' }, 400);
    }
    await setAppMode(db, mode, untilTs);
    return json({ ok: true, mode, until: untilTs });
  } catch (err) {
    return json({ error: 'Erreur lors du changement de mode : ' + err.message }, 500);
  }
}
