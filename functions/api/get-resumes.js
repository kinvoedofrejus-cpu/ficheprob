import { normalizePhone, json, kvKeyUser, kvGetJSON, getResumeList } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const kv = env.FPB_KV;
  try {
    const { phone, code } = await request.json();
    const phoneDigits = normalizePhone(phone);
    const cleanCode = (code || '').trim().toUpperCase();
    if (phoneDigits.length < 8 || !cleanCode) {
      return json({ ok: false, reason: 'invalid' }, 400);
    }

    const record = await kvGetJSON(kv, kvKeyUser(phoneDigits));
    if (!record || (record.code || '').toUpperCase() !== cleanCode) {
      return json({ ok: false, reason: 'invalid' }, 401);
    }
    if (!record.active) return json({ ok: false, reason: 'inactive' }, 403);
    if (record.expiryTs <= Date.now()) return json({ ok: false, reason: 'expired' }, 403);

    const list = await getResumeList(kv);
    const filtered = list
      .filter(r => !record.classe || r.classe === record.classe)
      .map(r => ({ id: r.id, matiere: r.matiere, classe: r.classe, titre: r.titre, texte: r.texte, updatedAt: r.updatedAt }))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    return json({ ok: true, resumes: filtered });
  } catch (err) {
    return json({ error: 'Erreur lors du chargement des résumés : ' + err.message }, 500);
  }
}
