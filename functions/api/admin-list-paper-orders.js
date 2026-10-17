import { requireAdmin, json } from './_shared.js';
import { ensurePaperOrdersTable, orderFromRow, getPaperConfig } from './_paper.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);
    await ensurePaperOrdersTable(db);
    const { results } = await db.prepare('SELECT * FROM paper_orders ORDER BY id DESC LIMIT 500').all();
    return json({ ok: true, orders: (results || []).map(orderFromRow), config: await getPaperConfig(db) });
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}
