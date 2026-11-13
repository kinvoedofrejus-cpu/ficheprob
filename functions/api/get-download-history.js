import { json, ensureDownloadTables, resolveOwner, DOWNLOAD_HISTORY_MAX } from './_shared.js';

/* Cloudflare Function — /api/get-download-history   (rubrique « Historique des téléchargements », novembre 2026)
   Liste, du plus récent au plus ancien, tout ce que le compte (ou l'appareil) a téléchargé sur la plateforme, hors fiches.
   Body : { phone?, code?, deviceId }   →   { ok, items: [{ id, kind, ref, label, classe, ts }] } */
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { phone, code, deviceId } = await request.json();
    await ensureDownloadTables(db);
    const who = await resolveOwner(db, { phone, code, deviceId });
    if (!who.owner) return json({ ok: false, reason: 'invalid' }, 400);
    const rows = await db.prepare('SELECT id, kind, ref, label, classe, ts FROM download_history WHERE owner = ? ORDER BY ts DESC, id DESC LIMIT ?')
      .bind(who.owner, DOWNLOAD_HISTORY_MAX).all();
    return json({ ok: true, items: (rows && rows.results) || [] });
  } catch (err) {
    return json({ ok: false, error: 'Erreur : ' + err.message }, 500);
  }
}
