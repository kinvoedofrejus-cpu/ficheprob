import {
  normalizePhone, json, getUser,
  countRecentDownloads, addDownloadRecord,
  RESUME_BULK_FREE_LIMIT, RESUME_BULK_WINDOW_MS, RESUME_BULK_PLAN_INDEX
} from './_shared.js';

/* Vérifie si un compte a droit à un téléchargement groupé GRATUIT (export
   "toute la classe" ou "toutes les classes") et le consomme si oui.
   Conditions :
   - le compte doit être actif, non expiré, ET avoir souscrit la formule
     "300 jours" (RESUME_BULK_PLAN_INDEX) — les autres formules n'ont pas
     accès à ces téléchargements gratuits et doivent payer, comme avant ;
   - RESUME_BULK_FREE_LIMIT téléchargements gratuits maximum sur une fenêtre
     glissante de RESUME_BULK_WINDOW_MS (300 jours) ; au 4e, la réponse
     indique que le paiement s'impose (reason: 'limit') et le front bascule
     alors sur le parcours de paiement existant.
   Le quota est vérifié ET consommé ici côté serveur pour rester fiable même
   si l'utilisateur change d'appareil. */
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { phone, code, scope, classe } = await request.json();
    const phoneDigits = normalizePhone(phone);
    const cleanCode = (code || '').trim().toUpperCase();
    if (phoneDigits.length < 8 || !cleanCode || !['classe', 'all'].includes(scope)) {
      return json({ ok: false, reason: 'invalid' }, 400);
    }

    const record = await getUser(db, phoneDigits);
    if (!record || (record.code || '').toUpperCase() !== cleanCode) {
      return json({ ok: false, reason: 'invalid' }, 401);
    }
    if (!record.active) return json({ ok: false, reason: 'inactive' }, 403);
    if (record.expiryTs <= Date.now()) return json({ ok: false, reason: 'expired' }, 403);

    if (record.planIndex !== RESUME_BULK_PLAN_INDEX) {
      // Formule autre que "300 jours" : pas de téléchargement gratuit, le
      // front doit proposer le paiement habituel (comme avant).
      return json({ ok: false, reason: 'plan_required', free: false });
    }

    const now = Date.now();
    const windowStart = now - RESUME_BULK_WINDOW_MS;
    const { count, oldest } = await countRecentDownloads(db, phoneDigits, windowStart, 'bulk');

    if (count >= RESUME_BULK_FREE_LIMIT) {
      return json({
        ok: false,
        reason: 'limit',
        free: false,
        remaining: 0,
        resetAt: (oldest || now) + RESUME_BULK_WINDOW_MS
      }, 429);
    }

    await addDownloadRecord(db, phoneDigits, now, 'bulk');

    return json({ ok: true, free: true, remaining: RESUME_BULK_FREE_LIMIT - (count + 1) });
  } catch (err) {
    return json({ error: "Erreur lors de la vérification du téléchargement groupé : " + err.message }, 500);
  }
}
