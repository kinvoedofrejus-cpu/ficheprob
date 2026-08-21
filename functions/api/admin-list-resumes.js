import { requireAdmin, json, listResumes } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);

    const list = await listResumes(db);
    return json({ ok: true, resumes: list });
  } catch (err) {
    return json({ error: 'Erreur lors du chargement des résumés : ' + err.message }, 500);
  }
}
