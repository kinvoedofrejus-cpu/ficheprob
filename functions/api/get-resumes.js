import { normalizePhone, json, kvKeyUser, kvGetJSON, getResumeList, getResumePurchases } from './_shared.js';

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

    // Les résumés sont classés par classe précise (CI, CP, CE1, CE2, CM1, CM2) : l'utilisateur
    // parcourt lui-même la classe puis la matière dans l'app, donc on ne filtre plus ici par la
    // classe (groupée) de son compte — on renvoie tous les résumés disponibles.
    const list = await getResumeList(kv);
    const filtered = list
      .map(r => ({ id: r.id, matiere: r.matiere, classe: r.classe, sa: r.sa || '', sequence: r.sequence || '', dossier: r.dossier || '', titre: r.titre, texte: r.texte, updatedAt: r.updatedAt }))
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));

    // Matières (classe+matiere) déjà achetées en intégralité par ce compte : donne un
    // téléchargement illimité, sans compter sur le quota gratuit hebdomadaire.
    const purchases = await getResumePurchases(kv, phoneDigits);

    return json({ ok: true, resumes: filtered, purchases });
  } catch (err) {
    return json({ error: 'Erreur lors du chargement des résumés : ' + err.message }, 500);
  }
}
