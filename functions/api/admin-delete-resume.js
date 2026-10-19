import { requireAdmin, json, deleteResume } from './_shared.js';

/* Supprime un résumé ({ token, id }) ou plusieurs d'un coup ({ token, ids:[…] }), images R2 comprises. */
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token, id, ids } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);
    const list = (Array.isArray(ids) ? ids : [id]).filter(Boolean).map(String).slice(0, 500);
    if (!list.length) return json({ error: 'Identifiant manquant' }, 400);

    let deleted = 0;
    for (const one of list) {
      const removed = await deleteResume(db, one);
      if (!removed) continue;
      deleted++;
      // Nettoyage des images R2 associées (best-effort, ne bloque pas la suppression)
      if (Array.isArray(removed.images) && removed.images.length) {
        await Promise.allSettled(removed.images.map(url => {
          const m = String(url).match(/key=([^&]+)/);
          if (!m) return Promise.resolve();
          const key = decodeURIComponent(m[1]);
          if (!key.startsWith('resumes/')) return Promise.resolve();
          return env.FPB_IMAGES.delete(key);
        }));
      }
    }
    if (!deleted) return json({ error: list.length > 1 ? 'Résumés introuvables' : 'Résumé introuvable' }, 404);
    return json({ ok: true, deleted });
  } catch (err) {
    return json({ error: 'Erreur lors de la suppression du résumé : ' + err.message }, 500);
  }
}
