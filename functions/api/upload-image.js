import { normalizePhone, json, kvKeyUser, kvGetJSON } from './_shared.js';

const MAX_SIZE = 4 * 1024 * 1024; // 4 Mo (l'image est déjà compressée côté client)

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.FPB_KV;
  try {
    const formData = await request.formData();
    const phone = formData.get('phone');
    const code = formData.get('code');
    const file = formData.get('image');

    const phoneDigits = normalizePhone(phone);
    const cleanCode = (code || '').trim().toUpperCase();
    if (phoneDigits.length < 8 || !cleanCode) {
      return json({ ok: false, reason: 'invalid' }, 400);
    }

    // Même vérification de session que le reste de l'app (voir record-usage.js / user-login.js)
    const record = await kvGetJSON(kv, kvKeyUser(phoneDigits));
    if (!record || (record.code || '').toUpperCase() !== cleanCode) {
      return json({ ok: false, reason: 'invalid' }, 401);
    }
    if (!record.active) return json({ ok: false, reason: 'inactive' }, 403);
    if (record.expiryTs <= Date.now()) return json({ ok: false, reason: 'expired' }, 403);

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
    const key = `${phoneDigits}/${Date.now()}-${crypto.randomUUID()}.${ext}`;

    await env.FPB_IMAGES.put(key, file.stream(), {
      httpMetadata: { contentType: file.type }
    });

    return json({ ok: true, url: `/api/get-image?key=${encodeURIComponent(key)}` });
  } catch (err) {
    return json({ error: "Erreur lors de l'upload de l'image : " + err.message }, 500);
  }
}
