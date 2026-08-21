import { requireAdmin, json } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { token, key } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ ok: false, reason: 'invalid' }, 401);
    if (!key || typeof key !== 'string' || !key.startsWith('resumes/')) {
      return json({ ok: false, reason: 'invalid-key' }, 400);
    }

    await env.FPB_IMAGES.delete(key);
    return json({ ok: true });
  } catch (err) {
    return json({ error: 'Erreur lors de la suppression : ' + err.message }, 500);
  }
}
