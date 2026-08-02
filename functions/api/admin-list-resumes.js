import { requireAdmin, json, getResumeList } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.FPB_KV;
  try {
    const { token } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);

    const list = await getResumeList(kv);
    list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    return json({ ok: true, resumes: list });
  } catch (err) {
    return json({ error: 'Erreur lors du chargement des résumés : ' + err.message }, 500);
  }
}
