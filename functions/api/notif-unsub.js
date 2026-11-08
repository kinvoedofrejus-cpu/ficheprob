import { ensureNotifTables } from './_notify.js';

/* GET /api/notif-unsub?t=<jeton>   — lien « Ne plus recevoir d'emails » présent en bas de chaque email. Ne demande aucune connexion. */
function page(msg) {
  return new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FicheProBot</title>'
    + '<body style="font-family:Arial,sans-serif;max-width:420px;margin:60px auto;padding:0 20px;text-align:center;color:#222">'
    + '<h2 style="color:#1f5fbf">FicheProBot</h2><p>' + msg + '</p><p><a href="/" style="color:#1f5fbf">Retour au site</a></p></body>',
    { status: 200, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
export async function onRequestGet(context) {
  const { request, env } = context;
  try {
    const t = new URL(request.url).searchParams.get('t') || '';
    if (t.length < 10 || t.length > 60) return page('Lien invalide.');
    await ensureNotifTables(env.FPB_DB);
    const r = await env.FPB_DB.prepare('UPDATE contacts SET opt_email = 0, updated_at = ? WHERE unsub_token = ?').bind(Date.now(), t).run();
    return page(r && r.meta && r.meta.changes ? "C'est fait : tu ne recevras plus d'emails de FicheProBot. Tu peux les réactiver à tout moment depuis ton profil dans l'application." : 'Lien invalide ou déjà utilisé.');
  } catch (e) { return page('Une erreur est survenue, réessaie plus tard.'); }
}
