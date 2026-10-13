import { requireAdmin, json, setDownloadPolicy, getDownloadPolicies, DOWNLOAD_POLICIES, DOWNLOAD_POLICY_KINDS } from './_shared.js';

/* Réglage admin : { token, kind: 'resources' | 'resumes', policy: 'normal' | 'payant' | 'gratuit' }
   normal  -> règles normales (1er téléchargement offert, etc.)
   payant  -> aucun téléchargement gratuit (ambassadeurs exemptés)
   gratuit -> téléchargement totalement gratuit et illimité pour tout le monde. */
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { token, kind, policy } = await request.json();
    if (!(await requireAdmin(env, token))) return json({ error: 'Non autorisé' }, 401);
    if (!DOWNLOAD_POLICY_KINDS.includes(kind)) return json({ error: "Type invalide (attendu 'resources' ou 'resumes')." }, 400);
    if (!DOWNLOAD_POLICIES.includes(policy)) return json({ error: "Politique invalide (attendu 'normal', 'payant' ou 'gratuit')." }, 400);
    await setDownloadPolicy(db, kind, policy);
    return json({ ok: true, downloadPolicies: await getDownloadPolicies(db) });
  } catch (err) {
    return json({ error: "Erreur lors du changement du réglage : " + err.message }, 500);
  }
}
