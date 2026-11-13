import { json, ensureDownloadTables, resolveOwner, DOWNLOAD_HISTORY_KINDS, DOWNLOAD_HISTORY_MAX } from './_shared.js';

/* Cloudflare Function — /api/record-download   (rubrique « Historique des téléchargements », novembre 2026)
   Enregistre un téléchargement (démarche, ressource, résumé, épreuve, cahier d'expression écrite, planification mensuelle, liste de
   la classe, point d'exécution) dans l'historique du compte (ou de l'appareil pour un visiteur). Les FICHES n'y figurent jamais.
   Body : { phone?, code?, deviceId, kind, ref?, label, classe? }   →   { ok }
   N'enregistre rien d'autre que le titre du document : aucun contenu, aucun nom d'élève. */
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const b = await request.json();
    const kind = String(b.kind || '').trim();
    if (!DOWNLOAD_HISTORY_KINDS.includes(kind)) return json({ ok: false, reason: 'kind' }, 400);
    const clip = (v, n) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, n);
    const label = clip(b.label, 160);
    if (!label) return json({ ok: false, reason: 'label' }, 400);
    await ensureDownloadTables(db);
    const who = await resolveOwner(db, { phone: b.phone, code: b.code, deviceId: b.deviceId });
    if (!who.owner) return json({ ok: false, reason: 'invalid' }, 400);
    await db.prepare('INSERT INTO download_history (owner, kind, ref, label, classe, ts) VALUES (?,?,?,?,?,?)')
      .bind(who.owner, kind, clip(b.ref, 200), label, clip(b.classe, 40), Date.now()).run();
    // On garde les DOWNLOAD_HISTORY_MAX plus récents.
    await db.prepare(`DELETE FROM download_history WHERE owner = ? AND id NOT IN
      (SELECT id FROM download_history WHERE owner = ? ORDER BY ts DESC, id DESC LIMIT ?)`)
      .bind(who.owner, who.owner, DOWNLOAD_HISTORY_MAX).run();
    return json({ ok: true });
  } catch (err) {
    return json({ ok: false, error: 'Erreur : ' + err.message }, 500);
  }
}
