import { requireAdmin, json } from './_shared.js';

// Cloudflare Function — /api/admin-upload-readyfiche-pdf
//
// Dépose UN fichier (PDF de base ou meta.json) déjà généré gratuitement
// ailleurs (voir admin-upload-readyfiche-pdfs.html + le script local de
// génération) dans R2, à la clé exacte attendue par get-readyfiche-pdf.js /
// get-readyfiche-meta.js : readyfiche-pdfs/{classe}/{matiere}.pdf (ou
// .meta.json). Remplace l'usage de Browser Rendering (payant) : ici, R2 est
// seulement utilisé comme espace de dépôt, sans aucun calcul côté Worker.
const MAX_SIZE = 60 * 1024 * 1024; // 60 Mo (une grosse matière peut peser plusieurs dizaines de Mo)

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const formData = await request.formData();
    const token = formData.get('token');
    if (!(await requireAdmin(env, token))) return json({ ok: false, reason: 'invalid' }, 401);

    const classe = String(formData.get('classe') || '').trim();
    const matiere = String(formData.get('matiere') || '').trim();
    const kind = String(formData.get('kind') || '').trim(); // 'pdf' | 'meta'
    const file = formData.get('file');

    if (!classe || !matiere || !['pdf', 'meta', 'docx', 'docxpreview'].includes(kind)) {
      return json({ ok: false, reason: 'invalid-params' }, 400);
    }
    if (!file || typeof file === 'string') {
      return json({ ok: false, reason: 'no-file' }, 400);
    }
    if (file.size > MAX_SIZE) {
      return json({ ok: false, reason: 'too-large' }, 413);
    }

    // 'docx' (29/10/2026) : Word de base au nouveau modèle, personnalisé au téléchargement (nom + filigrane) — voir get-readyfiche-docx.js.
    if (!/^[A-Za-z0-9_-]+$/.test(classe) || !/^[A-Za-z0-9_-]+$/.test(matiere)) return json({ ok: false, reason: 'invalid-params' }, 400);
    const key = kind === 'docx'
      ? `readyfiche-docx/${classe}/${matiere}.docx`
      : kind === 'docxpreview' ? `readyfiche-docx-preview/${classe}/${matiere}.docx`   // aperçu gratuit du Word (2 premières fiches)
      : (kind === 'pdf' ? `readyfiche-pdfs/${classe}/${matiere}.pdf` : `readyfiche-pdfs/${classe}/${matiere}.meta.json`);
    const contentType = (kind === 'docx' || kind === 'docxpreview') ? 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      : (kind === 'pdf' ? 'application/pdf' : 'application/json');

    await env.FPB_IMAGES.put(key, file.stream(), { httpMetadata: { contentType } });

    return json({ ok: true, key });
  } catch (err) {
    return json({ error: "Erreur lors du dépôt : " + err.message }, 500);
  }
}
