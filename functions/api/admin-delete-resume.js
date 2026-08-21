import { requireAdmin, json, deleteResume } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token, id } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);
    if (!id) return json({ error: 'Identifiant manquant' }, 400);

    const removed = await deleteResume(db, id);
    if (!removed) return json({ error: 'Résumé introuvable' }, 404);

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

    return json({ ok: true });
  } catch (err) {
    return json({ error: 'Erreur lors de la suppression du résumé : ' + err.message }, 500);
  }
}
