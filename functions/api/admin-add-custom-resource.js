import { requireAdmin, json } from './_shared.js';
import { CUSTOM_RES_PREFIX, ensureCustomResourcesTable } from './_customres.js';

/* Admin — POST multipart /api/admin-add-custom-resource : token, title, file (PDF, 20 Mo max).
   Ajoute un document à la carte « Autres » de l'onglet Ressources. */
const MAX_SIZE = 20 * 1024 * 1024;

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const fd = await request.formData();
    if (!(await requireAdmin(env, fd.get('token')))) return json({ error: 'Non autorisé' }, 401);
    const file = fd.get('file');
    const title = String(fd.get('title') || '').trim().replace(/\s+/g, ' ').slice(0, 120);
    if (!title) return json({ error: 'Titre manquant.' }, 400);
    if (!file || typeof file === 'string') return json({ error: 'Aucun fichier reçu.' }, 400);
    if (file.size > MAX_SIZE) return json({ error: 'Fichier trop lourd (20 Mo maximum).' }, 413);
    const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
    if (String.fromCharCode(...head) !== '%PDF-') return json({ error: 'Le fichier doit être un PDF.' }, 400);

    const id = CUSTOM_RES_PREFIX + Date.now().toString(36) + '-' + crypto.randomUUID().slice(0, 6);
    await env.FPB_IMAGES.put(`resource-pdfs/${id}.pdf`, file.stream(), { httpMetadata: { contentType: 'application/pdf' } });
    await ensureCustomResourcesTable(env.FPB_DB);
    await env.FPB_DB.prepare('INSERT INTO custom_resources (id, title, size, created_at) VALUES (?, ?, ?, ?)')
      .bind(id, title, file.size, Date.now()).run();
    return json({ ok: true, resource: { id, title, size: file.size } });
  } catch (err) {
    return json({ error: "Erreur lors de l'ajout : " + err.message }, 500);
  }
}
