import { requireAdmin, json, setTierLimits, getTierLimits } from './_shared.js';

/* Admin : règle le nombre d'accès de chaque niveau (gratuit / base / standard / premium) à chaque fonctionnalité.
   Body : { token, limits: { gratuit: { fiches: 2, assiste: 0, ... }, base: {...}, standard: {...}, premium: {...} } }
   Valeur : -1 = illimité, 0 = pas d'accès, n = n accès. */
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token, limits } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);
    await setTierLimits(db, limits);
    return json({ ok: true, tierLimits: await getTierLimits(db) });
  } catch (err) {
    return json({ error: "Erreur lors de l'enregistrement : " + err.message }, 500);
  }
}
