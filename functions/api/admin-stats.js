import { PLANS, requireAdmin, json, kvListByPrefix, kvGetJSON } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.FPB_KV;
  try {
    const { token } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);

    const userKeys = await kvListByPrefix(kv, 'user:');
    const now = Date.now();

    let totalUsers = 0, activeSubs = 0, expiredSubs = 0, disabledAccounts = 0, quotaUsedTotal = 0;
    const perPlan = PLANS.map(p => ({ label: p.label, count: 0 }));

    for (const key of userKeys) {
      const u = await kvGetJSON(kv, key);
      if (!u) continue;
      totalUsers++;
      quotaUsedTotal += u.quotaUsed || 0;
      if (!u.active) disabledAccounts++;
      else if (u.expiryTs > now) activeSubs++;
      else expiredSubs++;
      if (perPlan[u.planIndex]) perPlan[u.planIndex].count++;
    }

    const txKeys = await kvListByPrefix(kv, 'tx:');
    let totalRevenue = 0, paidCount = 0;
    for (const key of txKeys) {
      const t = await kvGetJSON(kv, key);
      if (t && t.status === 'paid') {
        totalRevenue += t.amount || 0;
        paidCount++;
      }
    }

    return json({ ok: true, totalUsers, activeSubs, expiredSubs, disabledAccounts, quotaUsedTotal, perPlan, totalRevenue, paidCount });
  } catch (err) {
    return json({ error: 'Erreur lors du calcul des statistiques : ' + err.message }, 500);
  }
}
