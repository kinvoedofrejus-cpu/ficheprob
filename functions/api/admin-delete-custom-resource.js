import { requireAdmin, json } from './_shared.js';
import { CUSTOM_RES_PREFIX, ensureCustomResourcesTable } from './_customres.js';

/* Admin — POST /api/admin-delete-custom-resource { token, ids:[…] } : supprime un ou plusieurs documents « Autres » (R2 + liste). */
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const b = await request.json();
    if (!(await requireAdmin(env, b.token))) return json({ error: 'Non autorisé' }, 401);
    const ids = (Array.isArray(b.ids) ? b.ids : [b.id]).map(String).filter(i => i.startsWith(CUSTOM_RES_PREFIX)).slice(0, 200);
    if (!ids.length) return json({ error: 'Aucun document à supprimer.' }, 400);
    await ensureCustomResourcesTable(env.FPB_DB);
    let deleted = 0;
    for (const id of ids) {
      try { await env.FPB_IMAGES.delete(`resource-pdfs/${id}.pdf`); } catch (e) { /* fichier déjà absent */ }
      const r = await env.FPB_DB.prepare('DELETE FROM custom_resources WHERE id = ?').bind(id).run();
      if (r && r.meta && r.meta.changes) deleted++;
    }
    return json({ ok: true, deleted });
  } catch (err) {
    return json({ error: 'Erreur lors de la suppression : ' + err.message }, 500);
  }
}
