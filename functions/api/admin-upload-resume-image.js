import { requireAdmin, json } from './_shared.js';

const MAX_SIZE = 4 * 1024 * 1024; // 4 Mo (l'image est déjà compressée côté client)

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const formData = await request.formData();
    const token = formData.get('token');
    const file = formData.get('image');

    if (!(await requireAdmin(env, token))) return json({ ok: false, reason: 'invalid' }, 401);

    if (!file || typeof file === 'string') {
      return json({ ok: false, reason: 'no-file' }, 400);
    }
    if (!file.type || !file.type.startsWith('image/')) {
      return json({ ok: false, reason: 'not-image' }, 400);
    }
    if (file.size > MAX_SIZE) {
      return json({ ok: false, reason: 'too-large' }, 413);
    }

    const ext = (file.type.split('/')[1] || 'jpg').replace(/[^a-z0-9]/gi, '') || 'jpg';
    const key = `resumes/${Date.now()}-${crypto.randomUUID()}.${ext}`;

    await env.FPB_IMAGES.put(key, file.stream(), {
      httpMetadata: { contentType: file.type }
    });

    return json({ ok: true, url: `/api/get-image?key=${encodeURIComponent(key)}`, key });
  } catch (err) {
    return json({ error: "Erreur lors de l'upload de l'image : " + err.message }, 500);
  }
}
