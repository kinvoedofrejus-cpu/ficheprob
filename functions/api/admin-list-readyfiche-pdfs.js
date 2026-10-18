import { requireAdmin, json } from './_shared.js';

// Cloudflare Function — /api/admin-list-readyfiche-pdfs
//
// Liste ce qui est RÉELLEMENT stocké dans R2 pour les Fiches Prêtes (clé, taille, date de dépôt) :
//   readyfiche-pdfs/{classe}/{matiere}.pdf  et  .meta.json
// Sert à la page admin-upload-readyfiche-pdfs.html pour VÉRIFIER qu'un dépôt a bien remplacé l'ancien fichier
// (la date de dépôt change) et que les noms correspondent au catalogue.
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json().catch(() => ({}));
    if (!(await requireAdmin(env, body.token))) return json({ ok: false, reason: 'invalid' }, 401);
    const classe = String(body.classe || '').trim();
    const prefix = 'readyfiche-pdfs/' + (classe ? classe + '/' : '');
    const objects = [];
    let cursor;
    do {
      const r = await env.FPB_IMAGES.list({ prefix, cursor, limit: 1000 });
      (r.objects || []).forEach(o => objects.push({ key: o.key, size: o.size, uploaded: o.uploaded }));
      cursor = r.truncated ? r.cursor : undefined;
    } while (cursor);
    return json({ ok: true, prefix, objects });
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}
