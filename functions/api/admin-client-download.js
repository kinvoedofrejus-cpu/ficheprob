import {
  requireAdmin, json, normalizePhone, getUser,
  getReadyFichePurchases, addReadyFichePurchase, getResumePurchases, addResumePurchase
} from './_shared.js';

/* Cloudflare Function — /api/admin-client-download   (novembre 2026)
   Onglet admin « Télécharger pour un client » : quand l'admin télécharge un résumé / une Fiche Prête POUR quelqu'un
   (vente par WhatsApp, etc.) avec l'option « Demander le numéro », le téléchargement est rattaché au NUMÉRO de la personne :
   - l'achat est enregistré (readyfiche_purchases / resume_purchases) → elle le retrouve dans « Mes achats » dès qu'elle se
     connecte avec ce numéro (le compte n'a pas besoin d'exister encore) ;
   - une ligne d'historique est ajoutée (table admin_downloads) : qui, quoi, quand, avec quel nom / filigrane.
   Le droit de téléchargement propre à la personne n'est PAS consommé (même règle que admin-grant-readyfiche).

   Body : { token, action:'record'|'history', ... }
   - 'record'  : { phone, kind:'readyfiche'|'resume', classe, matiere, format?, nom?, filigrane? }
                 matiere '*' = toute la classe ; pour les résumés, classe '*' + matiere '*' = toutes les classes.
   - 'history' : { phone? }  → 100 derniers téléchargements faits par l'admin (filtrés par numéro si fourni). */
async function ensureTable(db) {
  await db.prepare(`CREATE TABLE IF NOT EXISTS admin_downloads (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    phone TEXT, kind TEXT, classe TEXT, matiere TEXT, format TEXT, nom TEXT, filigrane INTEGER, created_at INTEGER
  )`).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_admin_downloads_phone ON admin_downloads(phone, created_at)').run();
}

const SAFE = /^[A-Za-z0-9_-]{1,60}$/;

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const body = await request.json().catch(() => ({}));
    if (!(await requireAdmin(env, body.token))) return json({ ok: false, reason: 'invalid' }, 401);
    await ensureTable(db);
    const action = String(body.action || 'record');

    if (action === 'history') {
      const phone = body.phone ? normalizePhone(body.phone) : '';
      const stmt = phone.length >= 8
        ? db.prepare('SELECT * FROM admin_downloads WHERE phone = ? ORDER BY created_at DESC LIMIT 100').bind(phone)
        : db.prepare('SELECT * FROM admin_downloads ORDER BY created_at DESC LIMIT 100');
      const { results } = await stmt.all();
      return json({ ok: true, rows: results || [] });
    }

    const phone = normalizePhone(body.phone);
    if (phone.length < 8) return json({ ok: false, error: 'Numéro de téléphone invalide.' }, 400);
    const kind = body.kind === 'resume' ? 'resume' : (body.kind === 'readyfiche' ? 'readyfiche' : '');
    if (!kind) return json({ ok: false, error: 'Type invalide.' }, 400);
    const classe = String(body.classe || '').trim();
    const matiere = String(body.matiere || '').trim();
    const classeOk = SAFE.test(classe) || (kind === 'resume' && classe === '*');
    const matiereOk = SAFE.test(matiere) || matiere === '*';
    if (!classeOk || !matiereOk) return json({ ok: false, error: 'Classe ou matière invalide.' }, 400);
    if (classe === '*' && matiere !== '*') return json({ ok: false, error: 'Classe ou matière invalide.' }, 400);

    let purchases;
    if (kind === 'readyfiche') {
      purchases = await addReadyFichePurchase(db, phone, classe, matiere, matiere === '*' ? 'classe' : 'matiere', null);
    } else {
      purchases = await addResumePurchase(db, phone, classe, matiere, null);
    }
    const format = body.format === 'word' ? 'word' : 'pdf';
    const nom = String(body.nom || '').trim().slice(0, 80);
    await db.prepare(`INSERT INTO admin_downloads (phone, kind, classe, matiere, format, nom, filigrane, created_at)
                      VALUES (?,?,?,?,?,?,?,?)`)
      .bind(phone, kind, classe, matiere, format, nom, body.filigrane ? 1 : 0, Date.now()).run();

    const user = await getUser(db, phone);
    const name = user ? ((user.prenom || '') + ' ' + (user.nom || '')).trim() : '';
    return json({ ok: true, name, hasAccount: !!user, purchases });
  } catch (err) {
    return json({ ok: false, error: 'Erreur : ' + err.message }, 500);
  }
}
