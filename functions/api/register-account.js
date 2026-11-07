import {
  normalizePhone, json, getUser, upsertUser, generateUniqueCode,
  GRATUIT_PLAN_INDEX, GRATUIT_PLAN_LABEL
} from './_shared.js';
import { requireVerifiedForNewAccount, saveAccountEmail, consumeToken } from './_verify.js';

/* Cloudflare Function — /api/register-account   (niveaux de compte, novembre 2026)
   Création d'un compte du niveau GRATUIT : le visiteur donne son nom, prénom et numéro, et reçoit tout de suite son
   code d'accès. Pas de durée ni de paiement : l'accès aux fonctionnalités est limité par le nombre d'accès réglé par
   l'admin pour le niveau Gratuit (onglet « Abonnements & prix »).
   Les niveaux payants (Base, Standard, Premium) passent par /api/create-payment : le compte est créé à la confirmation
   du paiement. Un compte Gratuit peut passer à un niveau payant à tout moment (upgrade) en payant avec le même numéro.
   Body : { nom, prenom, phone, classe? } -> { ok, phone, code } */
const GRATUIT_VALIDITY_MS = 100 * 365 * 24 * 60 * 60 * 1000;
const GRATUIT_QUOTA = 999999999; // pas de quota total : seule la limite par jour/mois du niveau s'applique

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { nom, prenom, phone, classe, verifyToken } = await request.json();
    const phoneDigits = normalizePhone(phone);
    if (phoneDigits.length < 8) return json({ error: 'Numéro de téléphone invalide.' }, 400);
    if (!nom || !String(nom).trim()) return json({ error: 'Nom manquant.' }, 400);
    if (!prenom || !String(prenom).trim()) return json({ error: 'Prénom manquant.' }, 400);

    const existing = await getUser(db, phoneDigits);
    if (existing) {
      return json({ error: 'Un compte existe déjà avec ce numéro. Connecte-toi avec ton code (ou passe à un niveau payant avec le même numéro).', reason: 'exists' }, 409);
    }

    const gate = await requireVerifiedForNewAccount(db, env, phoneDigits, verifyToken, existing);
    if (!gate.ok) return json({ error: 'Vérifie ton email avant de créer ton compte.', reason: 'verification_required' }, 403);

    const code = await generateUniqueCode(db, 8);
    if (!code) return json({ error: 'Impossible de générer un code unique, réessaie.' }, 500);

    const now = Date.now();
    const expiryTs = now + GRATUIT_VALIDITY_MS;
    const cleanClasse = ['maternelle', 'ci-cp', 'ce1-cm2'].includes(classe) ? classe : null;
    await upsertUser(db, {
      phone: phoneDigits,
      nom: String(nom).trim().slice(0, 80),
      prenom: String(prenom).trim().slice(0, 80),
      code,
      planIndex: GRATUIT_PLAN_INDEX,
      planLabel: GRATUIT_PLAN_LABEL,
      classe: cleanClasse,
      expiryTs,
      quotaTotal: GRATUIT_QUOTA,
      quotaUsed: 0,
      active: true,
      createdAt: now,
      updatedAt: now,
      history: [{ code, planLabel: GRATUIT_PLAN_LABEL, expiryTs, generatedAt: now, source: 'inscription-gratuite' }]
    });

    if (gate.token) { if (gate.email) await saveAccountEmail(db, phoneDigits, gate.email); await consumeToken(db, env, verifyToken); }
    return json({ ok: true, phone: phoneDigits, code });
  } catch (err) {
    return json({ error: "Erreur lors de la création du compte : " + err.message }, 500);
  }
}
