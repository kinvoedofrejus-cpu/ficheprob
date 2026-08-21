import { signToken, json, ADMIN_EMAIL_HARDCODED, ADMIN_PASSWORD_HARDCODED } from './_shared.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const { email, password } = await request.json();
    const ADMIN_EMAIL = ADMIN_EMAIL_HARDCODED;
    const ADMIN_PASSWORD = ADMIN_PASSWORD_HARDCODED;

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
