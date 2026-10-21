import { requireAdmin, json, setFreeLimits, getFreeLimits } from './_shared.js';

/* Règle le nombre de fiches gratuites en mode gratuit :
   { token, daily, weekly } -> fiches gratuites par jour et par semaine (par appareil). */
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token, daily, weekly } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);
    await setFreeLimits(db, daily, weekly);
    return json({ ok: true, freeLimits: await getFreeLimits(db) });
  } catch (err) {
    return json({ error: "Erreur lors de l'enregistrement : " + err.message }, 500);
  }
}
