import { json, trackReadyEvent } from './_shared.js';

/* Cloudflare Function — /api/track-readyfiche (public, 29/10/2026)
   Compte les aperçus ouverts (PDF ou Word) pour les statistiques admin. Ne stocke aucune donnée personnelle : seulement
   (jour, événement, classe, matière) -> compteur. Les téléchargements sont comptés par record-readyfiche-download.js. */
export async function onRequestPost(context) {
  try {
    const b = await context.request.json().catch(() => ({}));
    if (b.event === 'preview' || b.event === 'preview_word') await trackReadyEvent(context.env.FPB_DB, b.event, b.classe, b.matiere);
    return json({ ok: true });
  } catch (e) { return json({ ok: true }); }
}
