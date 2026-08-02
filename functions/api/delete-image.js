import { normalizePhone, json, kvKeyUser, kvGetJSON } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.FPB_KV;
  try {
    const { phone, code, key } = await request.json();
    const phoneDigits = normalizePhone(phone);
    const cleanCode = (code || '').trim().toUpperCase();
    if (phoneDigits.length < 8 || !cleanCode || !key) {
      return json({ ok: false, reason: 'invalid' }, 400);
    }

    const record = await kvGetJSON(kv, kvKeyUser(phoneDigits));
    if (!record || (record.code || '').toUpperCase() !== cleanCode) {
      return json({ ok: false, reason: 'invalid' }, 401);
    }

    // Sécurité : un utilisateur ne peut supprimer que ses propres images
    // (la clé commence toujours par son numéro de téléphone, voir upload-image.js)
    if (!key.startsWith(phoneDigits + '/')) {
      return json({ ok: false, reason: 'forbidden' }, 403);
    }

    await env.FPB_IMAGES.delete(key);
    return json({ ok: true });
  } catch (err) {
    return json({ error: 'Erreur lors de la suppression : ' + err.message }, 500);
  }
}
