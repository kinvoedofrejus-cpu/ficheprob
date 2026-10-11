import { requireAdmin, json, listUsers, upsertUser } from './_shared.js';

/* Action ponctuelle et immédiate : ajoute "bonus" fiches au quota de TOUS
   les comptes actuellement actifs et non expirés (donc ayant déjà payé au
   moins la formule minimale). Ne touche pas aux comptes inactifs ou expirés.
   Distinct du réglage permanent (admin-set-min-plan-bonus.js), qui ne
   s'applique qu'aux futures souscriptions de la formule minimale. */
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token, bonus } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);
    const n = Math.max(0, parseInt(bonus, 10) || 0);
    if (!n) return json({ error: 'Indique un nombre de fiches supérieur à 0.' }, 400);

    const now = Date.now();
    const users = await listUsers(db);
    let grantedCount = 0;
    for (const u of users) {
      if (!u.active) continue;
      if (!u.expiryTs || u.expiryTs <= now) continue;
      u.quotaTotal = (u.quotaTotal || 0) + n;
      u.updatedAt = now;
      await upsertUser(db, u);
      grantedCount++;
    }
    return json({ ok: true, grantedCount, bonus: n });
  } catch (err) {
    return json({ error: "Erreur lors de l'offre groupée : " + err.message }, 500);
  }
}
