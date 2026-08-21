import { PLANS, requireAdmin, json, listUsers, listTx } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);

    const users = await listUsers(db);
    const now = Date.now();

    let totalUsers = 0, activeSubs = 0, expiredSubs = 0, disabledAccounts = 0, quotaUsedTotal = 0;
    const perPlan = PLANS.map(p => ({ label: p.label, count: 0 }));

    for (const u of users) {
      totalUsers++;
      quotaUsedTotal += u.quotaUsed || 0;
      if (!u.active) disabledAccounts++;
      else if (u.expiryTs > now) activeSubs++;
      else expiredSubs++;
      if (perPlan[u.planIndex]) perPlan[u.planIndex].count++;
    }

    const txs = await listTx(db);
    let totalRevenue = 0, paidCount = 0;
    for (const t of txs) {
      if (t.status === 'paid') {
        totalRevenue += t.amount || 0;
        paidCount++;
      }
    }

    return json({ ok: true, totalUsers, activeSubs, expiredSubs, disabledAccounts, quotaUsedTotal, perPlan, totalRevenue, paidCount });
  } catch (err) {
    return json({ error: 'Erreur lors du calcul des statistiques : ' + err.message }, 500);
  }
}
