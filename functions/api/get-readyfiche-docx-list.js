import { json } from './_shared.js';

/* Endpoint public — quelles matières ont un Word (nouveau modèle) déposé dans R2 :
   { ok:true, available: { CM1:['mathematique',...], CE2:[...] } }. Lu par index.html pour n'afficher le choix « Word »
   que là où le fichier existe (29/10/2026). */
export async function onRequestGet(context) {
  try {
    const available = {};
    let cursor;
    do {
      const r = await context.env.FPB_IMAGES.list({ prefix: 'readyfiche-docx/', cursor, limit: 1000 });
      (r.objects || []).forEach(o => {
        const m = /^readyfiche-docx\/([^/]+)\/([^/]+)\.docx$/.exec(o.key);
        if (m) (available[m[1]] = available[m[1]] || []).push(m[2]);
      });
      cursor = r.truncated ? r.cursor : undefined;
    } while (cursor);
    return json({ ok: true, available });
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}
