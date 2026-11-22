import { json } from './_shared.js';

// Cloudflare Function — /api/get-readyfiche-titles  (POST { classe, matiere })
//
// Renvoie la liste des TITRES des fiches d'une matière (index rangé dans R2 par l'admin avec
// admin-regrouper-fiches.html : readyfiche-pdfs/{classe}/{matiere}.titles.json). Les titres font partie du
// catalogue public (comme les aperçus) : aucun contrôle d'achat ici. Le PDF lui-même, lui, reste protégé
// (get-readyfiche-pdf.js) : sans achat, on ne voit que la liste des titres.
export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { classe, matiere } = await request.json().catch(() => ({}));
    if (!/^[A-Za-z0-9_-]{1,60}$/.test(String(classe || '')) || !/^[A-Za-z0-9_-]{1,60}$/.test(String(matiere || ''))) {
      return json({ ok: false, reason: 'invalid' }, 400);
    }
    const obj = await env.FPB_IMAGES.get(`readyfiche-pdfs/${classe}/${matiere}.titles.json`);
    if (!obj) return json({ ok: false, reason: 'no-titles' }, 404);
    const doc = await obj.json();
    return json({ ok: true, doc });
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}
