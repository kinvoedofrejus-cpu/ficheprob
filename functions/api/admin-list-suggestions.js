import { requireAdmin, json, ensureSuggestionsTable, suggestionFromRow } from './_shared.js';

/* Liste complète des suggestions / corrections / erreurs ({ token }). */
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { token } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);
    await ensureSuggestionsTable(env.FPB_DB);
    const { results } = await env.FPB_DB.prepare('SELECT * FROM suggestions ORDER BY id DESC LIMIT 2000').all();
    return json({ ok: true, suggestions: (results || []).map(suggestionFromRow) });
  } catch (err) {
    return json({ error: 'Erreur de chargement des suggestions : ' + err.message }, 500);
  }
}
