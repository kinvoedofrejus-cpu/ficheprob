import { requireAdmin, json } from './_shared.js';

// Cloudflare Function — /api/admin-restore-file   (novembre 2026)
// Bouton « Restaurer » de l'admin (onglet Sauvegarde) : remet UN fichier d'un zip de sauvegarde dans R2,
// à la clé exacte qu'il avait (PDF / meta.json des Fiches Prêtes, Word + aperçus, ressources, images de résumés).
// Réservé à l'admin et limité aux mêmes dossiers que la sauvegarde (voir admin-backup-file.js).
//
// POST multipart : token, key, file, overwrite ('1' = écraser l'existant ; sinon on ne remet que ce qui manque).
// Réponse : { ok:true, key, skipped? }   (skipped = le fichier existait déjà et overwrite n'était pas demandé)
const ALLOWED = ['readyfiche-pdfs/', 'readyfiche-docx/', 'readyfiche-docx-preview/', 'resumes/', 'resource-pdfs/'];
const MAX_SIZE = 90 * 1024 * 1024; // 90 Mo (limite de requête des Workers : 100 Mo)

const TYPES = {
  pdf: 'application/pdf',
  json: 'application/json',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml'
};

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const formData = await request.formData();
    if (!(await requireAdmin(env, formData.get('token')))) return json({ ok: false, reason: 'invalid' }, 401);

    const key = String(formData.get('key') || '');
    if (!ALLOWED.some(p => key.startsWith(p)) || key.length > 300 || key.includes('..') ||
        key.includes('\\') || key.includes('//') || key.endsWith('/')) {
      return json({ ok: false, reason: 'invalid-key' }, 400);
    }
    const file = formData.get('file');
    if (!file || typeof file === 'string') return json({ ok: false, reason: 'no-file' }, 400);
    if (file.size > MAX_SIZE) return json({ ok: false, reason: 'too-large' }, 413);

    if (String(formData.get('overwrite') || '') !== '1') {
      const existing = await env.FPB_IMAGES.head(key);
      if (existing) return json({ ok: true, key, skipped: true });
    }

    const ext = (key.split('.').pop() || '').toLowerCase();
    await env.FPB_IMAGES.put(key, file.stream(), {
      httpMetadata: { contentType: TYPES[ext] || 'application/octet-stream' }
    });
    return json({ ok: true, key });
  } catch (err) {
    return json({ error: 'Erreur lors de la restauration : ' + err.message }, 500);
  }
}
