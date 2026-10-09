import { requireAdmin, json } from './_shared.js';

// Cloudflare Function — /api/admin-upload-resource-pdf
//
// Dépose UN fichier (PDF de ressource didactique, ou son meta.json de
// positions "Par :" généré par resource_tools/detect_par_slots.py) dans R2,
// à la clé exacte attendue par get-resource-pdf.js / get-resource-meta.js :
// resource-pdfs/{id}.pdf (ou .meta.json). Gratuit : R2 est seulement utilisé
// comme espace de dépôt, sans aucun calcul côté Worker.
const MAX_SIZE = 20 * 1024 * 1024; // 20 Mo

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const formData = await request.formData();
    const token = formData.get('token');
    if (!(await requireAdmin(env, token))) return json({ ok: false, reason: 'invalid' }, 401);

    const id = String(formData.get('id') || '').trim();
    const kind = String(formData.get('kind') || '').trim(); // 'pdf' | 'meta'
    const file = formData.get('file');

    if (!id || !['pdf', 'meta'].includes(kind)) {
      return json({ ok: false, reason: 'invalid-params' }, 400);
    }
    if (!file || typeof file === 'string') {
      return json({ ok: false, reason: 'no-file' }, 400);
    }
    if (file.size > MAX_SIZE) {
      return json({ ok: false, reason: 'too-large' }, 413);
    }

    const key = kind === 'pdf'
      ? `resource-pdfs/${id}.pdf`
      : `resource-pdfs/${id}.meta.json`;
    const contentType = kind === 'pdf' ? 'application/pdf' : 'application/json';

    await env.FPB_IMAGES.put(key, file.stream(), { httpMetadata: { contentType } });

    return json({ ok: true, key });
  } catch (err) {
    return json({ error: "Erreur lors du dépôt : " + err.message }, 500);
  }
}
