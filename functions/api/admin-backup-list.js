import { requireAdmin, json } from './_shared.js';

// Cloudflare Function — /api/admin-backup-list  (POST { token, kind })
//
// Sauvegarde admin : renvoie la liste des fichiers R2 à sauvegarder + les lignes D1 correspondantes.
//   kind = 'readyfiches' → R2 readyfiche-pdfs/                         (PDF + .meta.json des Fiches Prêtes)
//   kind = 'docx'        → R2 readyfiche-docx/ + readyfiche-docx-preview/ (Word des Fiches Prêtes + aperçus)
//   kind = 'resumes'     → R2 resumes/ (images) + D1 resumes, hidden_matieres, hidden_classes
//   kind = 'resources'   → R2 resource-pdfs/ (PDF + .meta.json) + D1 custom_resources (« Autres »)
//   kind = 'comptes'     → D1 : comptes, paiements, achats, téléchargements, réglages, promos, ambassadeurs,
//                          suggestions, commandes papier, historique des téléchargements faits par l'admin
//                          (aucun fichier R2). ⚠ contient les codes d'accès des comptes : garder ce zip privé.
const KINDS = {
  readyfiches: { prefixes: ['readyfiche-pdfs/'], tables: [] },
  docx: { prefixes: ['readyfiche-docx/', 'readyfiche-docx-preview/'], tables: [] },
  resumes: { prefixes: ['resumes/'], tables: ['resumes', 'hidden_matieres', 'hidden_classes'] },
  resources: { prefixes: ['resource-pdfs/'], tables: ['custom_resources'] },
  comptes: {
    prefixes: [],
    tables: [
      'users', 'transactions', 'readyfiche_purchases', 'readyfiche_downloads', 'resume_purchases', 'resume_downloads',
      'resource_purchases', 'first_downloads', 'download_usage', 'download_credits', 'settings', 'promos',
      'ambassadors', 'suggestions', 'paper_orders', 'account_emails', 'admin_downloads'
    ]
  }
};

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    const body = await request.json().catch(() => ({}));
    if (!(await requireAdmin(env, body.token))) return json({ ok: false, reason: 'invalid' }, 401);
    const cfg = KINDS[String(body.kind || '')];
    if (!cfg) return json({ ok: false, reason: 'invalid-kind' }, 400);

    const objects = [];
    for (const prefix of cfg.prefixes) {
      let cursor;
      do {
        const r = await env.FPB_IMAGES.list({ prefix, cursor, limit: 1000 });
        (r.objects || []).forEach(o => objects.push({ key: o.key, size: o.size }));
        cursor = r.truncated ? r.cursor : undefined;
      } while (cursor);
    }

    const tables = {};
    for (const t of cfg.tables) {
      try {
        const { results } = await env.FPB_DB.prepare(`SELECT * FROM ${t}`).all();
        tables[t] = results || [];
      } catch (e) {
        tables[t] = []; // table pas encore créée (ex. custom_resources sans ressource « Autres »)
      }
    }
    return json({ ok: true, objects, tables });
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}
