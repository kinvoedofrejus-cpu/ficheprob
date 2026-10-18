import { requireAdmin, json } from './_shared.js';
import { ensurePaperOrdersTable, orderFromRow, getPaperConfig, readMetaPages, loadCatalogue } from './_paper.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);
    await ensurePaperOrdersTable(db);
    const { results } = await db.prepare('SELECT * FROM paper_orders ORDER BY id DESC LIMIT 500').all();
    // Nombre de pages lu automatiquement dans les .meta.json de R2 (affiché dans la grille des prix, modifiable à la main).
    const pagesAuto = {};
    try {
      const cat = await loadCatalogue(env, request);
      for (const classe of Object.keys(cat)) {
        for (const k of Object.keys(cat[classe])) {
          const n = await readMetaPages(env, classe, k);
          if (n) pagesAuto[classe + '::' + k] = n;
        }
      }
    } catch (e) { /* catalogue ou R2 indisponible : la grille fonctionne quand même */ }
    return json({ ok: true, orders: (results || []).map(orderFromRow), config: await getPaperConfig(db), pagesAuto });
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}
