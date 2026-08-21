import {
  normalizePhone, json, getUser,
  countRecentDownloads, addDownloadRecord, listResumes, getResumePurchases, hasResumePurchase,
  RESUME_FREE_DOWNLOAD_LIMIT, RESUME_FREE_DOWNLOAD_WINDOW_MS
} from './_shared.js';

// Vérifie le compte, puis :
//  - si la matière du résumé a été achetée en intégralité par ce compte -> téléchargement
//    illimité, ne consomme rien.
//  - sinon -> vérifie/consomme 1 unité du quota gratuit (RESUME_FREE_DOWNLOAD_LIMIT par
//    fenêtre glissante de 7 jours). Le quota est vérifié ET incrémenté ici (côté serveur),
//    pour que la limite soit fiable même si l'utilisateur change d'appareil.
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { phone, code, resumeId } = await request.json();
    const phoneDigits = normalizePhone(phone);
    const cleanCode = (code || '').trim().toUpperCase();
    if (phoneDigits.length < 8 || !cleanCode || !resumeId) {
      return json({ ok: false, reason: 'invalid' }, 400);
    }

    const record = await getUser(db, phoneDigits);
    if (!record || (record.code || '').toUpperCase() !== cleanCode) {
      return json({ ok: false, reason: 'invalid' }, 401);
    }
    if (!record.active) return json({ ok: false, reason: 'inactive' }, 403);
    if (record.expiryTs <= Date.now()) return json({ ok: false, reason: 'expired' }, 403);

    const resumeList = await listResumes(db);
    const resume = resumeList.find(r => r.id === resumeId);
    if (!resume) return json({ ok: false, reason: 'notfound' }, 404);

    const purchases = await getResumePurchases(db, phoneDigits);
    if (hasResumePurchase(purchases, resume.classe, resume.matiere)) {
      return json({ ok: true, unlimited: true });
    }

    const now = Date.now();
    const windowStart = now - RESUME_FREE_DOWNLOAD_WINDOW_MS;
    const { count, oldest } = await countRecentDownloads(db, phoneDigits, windowStart);

    if (count >= RESUME_FREE_DOWNLOAD_LIMIT) {
      return json({
        ok: false,
        reason: 'limit',
        remaining: 0,
        resetAt: (oldest || now) + RESUME_FREE_DOWNLOAD_WINDOW_MS
      }, 429);
    }

    await addDownloadRecord(db, phoneDigits, now);

    return json({ ok: true, remaining: RESUME_FREE_DOWNLOAD_LIMIT - (count + 1) });
  } catch (err) {
    return json({ error: "Erreur lors de l'enregistrement du téléchargement : " + err.message }, 500);
  }
}
