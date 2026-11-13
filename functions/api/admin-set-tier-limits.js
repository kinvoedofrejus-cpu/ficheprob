import { requireAdmin, json, setTierLimits, getTierLimits, setTierLimitsByDays, getTierLimitsByDays, setTiersEnabled, getTiersEnabled, TIER_DURATIONS } from './_shared.js';

/* Admin : règle le nombre d'accès de chaque niveau (gratuit / base / standard / premium) à chaque fonctionnalité,
   et, si besoin, un nombre différent pour chaque durée d'abonnement (30 / 90 / 300 jours).
   Body : { token, limits: { gratuit: { fiches: 2, ... }, base: {...}, standard: {...}, premium: {...} },
            byDays?: { base: { 30: { fiches: 5 }, 90: {...}, 300: {...} }, standard: {...}, premium: {...} } }
   Valeur : -1 = illimité, 0 = pas d'accès, n = n accès. Dans byDays, une fonctionnalité absente = même nombre que le niveau.
   tiersEnabled (booléen, facultatif) : autorise ou non les niveaux Base/Standard/Premium (sinon : mode gratuit seul).
   byDays absent de la requête = réglages par durée inchangés ; byDays = {} les efface tous. */
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token, limits, byDays, tiersEnabled } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);
    if (limits && typeof limits === 'object') await setTierLimits(db, limits);
    if (typeof tiersEnabled === 'boolean') await setTiersEnabled(db, tiersEnabled);
    if (byDays && typeof byDays === 'object') await setTierLimitsByDays(db, byDays);
    return json({ ok: true, tiersEnabled: await getTiersEnabled(db), tierLimits: await getTierLimits(db), tierLimitsByDays: await getTierLimitsByDays(db), tierDurations: TIER_DURATIONS });
  } catch (err) {
    return json({ error: "Erreur lors de l'enregistrement : " + err.message }, 500);
  }
}
