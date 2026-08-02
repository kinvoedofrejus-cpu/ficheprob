import { signToken, json } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { email, password } = await request.json();
    const ADMIN_EMAIL = env.ADMIN_EMAIL || '';
    const ADMIN_PASSWORD = env.ADMIN_PASSWORD || '';

    if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
      return json({ error: "Compte administrateur non configuré côté serveur (variables d'environnement manquantes)." }, 500);
    }

    const emailOk = (email || '').trim().toLowerCase() === ADMIN_EMAIL.trim().toLowerCase();
    const passOk = (password || '') === ADMIN_PASSWORD;

    if (!emailOk || !passOk) {
      return json({ error: 'Email ou mot de passe incorrect.' }, 401);
    }

    const token = await signToken(env, { role: 'admin', email: ADMIN_EMAIL, exp: Date.now() + 12 * 60 * 60 * 1000 });
    return json({ ok: true, token });
  } catch (err) {
    return json({ error: 'Erreur lors de la connexion : ' + err.message }, 500);
  }
}
