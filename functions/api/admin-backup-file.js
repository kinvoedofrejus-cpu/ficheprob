import { requireAdmin, json } from './_shared.js';

// Cloudflare Function — /api/admin-backup-file  (POST { token, key })
// Renvoie UN fichier R2 (réservé à l'admin, et limité aux dossiers sauvegardables).
const ALLOWED = ['readyfiche-pdfs/', 'resumes/', 'resource-pdfs/'];

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json().catch(() => ({}));
    if (!(await requireAdmin(env, body.token))) return json({ ok: false, reason: 'invalid' }, 401);
    const key = String(body.key || '');
    if (!ALLOWED.some(p => key.startsWith(p)) || key.includes('..')) return json({ ok: false, reason: 'invalid-key' }, 400);
    const obj = await env.FPB_IMAGES.get(key);
    if (!obj) return json({ ok: false, reason: 'not-found' }, 404);
    return new Response(obj.body, {
      headers: { 'Content-Type': obj.httpMetadata?.contentType || 'application/octet-stream', 'Cache-Control': 'no-store' }
    });
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}
