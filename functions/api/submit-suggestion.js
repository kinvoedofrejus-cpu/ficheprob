import { json, normalizePhone, ensureSuggestionsTable, SUGGESTION_TYPES } from './_shared.js';

/* Cloudflare Function — /api/submit-suggestion
   Enregistre une suggestion, une proposition de correction ou un signalement d'erreur.
   Public (aucun compte requis). Body : { type, concerne?, classe?, matiere?, message, nom?, phone? } */
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const b = await request.json();
    const clean = (v, max = 120) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
    const type = clean(b.type, 20);
    const message = String(b.message || '').replace(/\r/g, '').trim().slice(0, 3000);
    const concerne = clean(b.concerne, 80);
    const classe = clean(b.classe, 30);
    const matiere = clean(b.matiere, 80);
    const nom = clean(b.nom, 80);
    const phoneRaw = normalizePhone(b.phone);

    if (!SUGGESTION_TYPES.includes(type)) return json({ error: 'Type invalide.' }, 400);
    if (message.length < 5) return json({ error: 'Merci de décrire votre message (quelques mots au minimum).' }, 400);
    if (phoneRaw && (phoneRaw.length < 8 || phoneRaw.length > 15)) return json({ error: 'Numéro invalide.' }, 400);

    await ensureSuggestionsTable(db);

    // Anti double-envoi (double clic, réseau lent) : même message dans les 2 dernières minutes
    const dup = await db.prepare('SELECT numero FROM suggestions WHERE message = ? AND phone = ? AND created_at > ? LIMIT 1')
      .bind(message, phoneRaw, Date.now() - 2 * 60 * 1000).first();
    if (dup) return json({ ok: true, already: true, numero: dup.numero });

    // Limite simple contre l'abus : 20 envois par heure et par numéro (si fourni)
    if (phoneRaw) {
      const c = await db.prepare('SELECT COUNT(*) AS n FROM suggestions WHERE phone = ? AND created_at > ?')
        .bind(phoneRaw, Date.now() - 60 * 60 * 1000).first();
      if (c && c.n >= 20) return json({ error: "Trop d'envois récents. Réessayez plus tard." }, 429);
    }

    const now = Date.now();
    const res = await db.prepare(
      `INSERT INTO suggestions (numero, type, concerne, classe, matiere, message, nom, phone, status, created_at)
       VALUES ('', ?, ?, ?, ?, ?, ?, ?, 'nouveau', ?)`
    ).bind(type, concerne, classe, matiere, message, nom, phoneRaw, now).run();
    const id = res.meta.last_row_id;
    const numero = 'SUG-' + new Date(now).getFullYear() + '-' + String(id).padStart(4, '0');
    await db.prepare('UPDATE suggestions SET numero = ? WHERE id = ?').bind(numero, id).run();
    return json({ ok: true, numero });
  } catch (err) {
    return json({ error: "Erreur lors de l'enregistrement : " + err.message }, 500);
  }
}
