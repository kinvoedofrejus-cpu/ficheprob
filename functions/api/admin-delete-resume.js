import { requireAdmin, json, getResumeList, saveResumeList } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.FPB_KV;
  try {
    const { token, id } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);
    if (!id) return json({ error: 'Identifiant manquant' }, 400);

    const list = await getResumeList(kv);
    const next = list.filter(r => r.id !== id);
    if (next.length === list.length) return json({ error: 'Résumé introuvable' }, 404);

    await saveResumeList(kv, next);
    return json({ ok: true });
  } catch (err) {
    return json({ error: 'Erreur lors de la suppression du résumé : ' + err.message }, 500);
  }
}
