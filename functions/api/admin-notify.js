import { requireAdmin, json, GRATUIT_PLAN_INDEX } from './_shared.js';
import { ensureNotifTables, channelsStatus, deliverToRecipients, RECIPIENT_FROM, RECIPIENT_COLS } from './_notify.js';

/* POST /api/admin-notify   { token, action, ... }   (espace admin > onglet « Notifications »)
   action « stats »      : nombre de comptes / contacts / appareils push, état des canaux (configurés ou non) ;
   action « count »      : nombre de destinataires pour une audience + canaux ;
   action « send »       : envoie UN LOT (12 destinataires par défaut) et renvoie le curseur ; l'écran admin rappelle jusqu'à la fin.
                           Raison : une Function Cloudflare ne peut faire qu'un nombre limité de requêtes sortantes par appel.
   action « history »    : derniers envois ;
   action « contacts »   : liste des contacts (export CSV + liste WhatsApp manuelle) ;
   audience : { status: all|payant|gratuit|bientot, classe: ''|maternelle|ci-cp|ce1-cm2, only: [numéros] (test) } */
const DEFAULT_BATCH = 12;

function audienceSql(aud, afterPhone) {
  const where = ['(COALESCE(c.opt_email,1) = 1 OR COALESCE(c.opt_whatsapp,1) = 1 OR COALESCE(c.opt_push,1) = 1)'];
  const binds = [];
  const now = Date.now();
  if (afterPhone) { where.push('p.phone > ?'); binds.push(afterPhone); }
  const a = aud || {};
  if (Array.isArray(a.only) && a.only.length) {
    const ph = a.only.map(p => String(p).replace(/\D/g, '')).filter(Boolean).slice(0, 20);
    if (ph.length) { where.push('p.phone IN (' + ph.map(() => '?').join(',') + ')'); binds.push(...ph); }
  } else {
    if (a.status === 'payant') { where.push('u.plan_index IS NOT NULL AND u.plan_index != ? AND u.expiry_ts > ?'); binds.push(GRATUIT_PLAN_INDEX, now); }
    else if (a.status === 'gratuit') { where.push('u.plan_index = ?'); binds.push(GRATUIT_PLAN_INDEX); }
    else if (a.status === 'bientot') { where.push('u.plan_index IS NOT NULL AND u.plan_index != ? AND u.expiry_ts > ? AND u.expiry_ts < ?'); binds.push(GRATUIT_PLAN_INDEX, now, now + 7 * 86400000); }
    if (['maternelle', 'ci-cp', 'ce1-cm2'].includes(a.classe)) { where.push('u.classe = ?'); binds.push(a.classe); }
  }
  return { where: where.join(' AND '), binds };
}
const FROM = RECIPIENT_FROM;

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const body = await request.json();
    if (!(await requireAdmin(env, body.token))) return json({ error: 'Non autorisé' }, 401);
    await ensureNotifTables(db);
    const action = body.action || 'stats';

    if (action === 'stats') {
      const r = await db.prepare(`SELECT COUNT(*) AS n,
        SUM(CASE WHEN COALESCE(c.email, ae.email) IS NOT NULL AND COALESCE(c.opt_email,1) = 1 THEN 1 ELSE 0 END) AS e,
        SUM(CASE WHEN c.whatsapp IS NOT NULL THEN 1 ELSE 0 END) AS w,
        SUM(CASE WHEN (SELECT COUNT(*) FROM push_subs s WHERE s.phone = p.phone) > 0 THEN 1 ELSE 0 END) AS ps ${FROM}`).first();
      const dev = await db.prepare('SELECT COUNT(*) AS n FROM push_subs').first();
      return json({ ok: true, channels: channelsStatus(env), users: (r && r.n) || 0, contacts: (r && r.n) || 0,
        optEmail: (r && r.e) || 0, optWhatsapp: (r && r.w) || 0, optPush: (r && r.ps) || 0, devices: (dev && dev.n) || 0 });
    }

    if (action === 'count') {
      const q = audienceSql(body.audience, '');
      const r = await db.prepare(`SELECT COUNT(*) AS n,
        SUM(CASE WHEN (SELECT COUNT(*) FROM push_subs s WHERE s.phone = p.phone) > 0 AND COALESCE(c.opt_push,1) = 1 THEN 1 ELSE 0 END) AS p,
        SUM(CASE WHEN COALESCE(c.email, ae.email) IS NOT NULL AND COALESCE(c.opt_email,1) = 1 THEN 1 ELSE 0 END) AS e,
        SUM(CASE WHEN COALESCE(c.opt_whatsapp,1) = 1 THEN 1 ELSE 0 END) AS w ${FROM} WHERE ${q.where}`).bind(...q.binds).first();
      return json({ ok: true, total: (r && r.n) || 0, push: (r && r.p) || 0, email: (r && r.e) || 0, whatsapp: (r && r.w) || 0 });
    }

    if (action === 'history') {
      const { results } = await db.prepare('SELECT * FROM broadcasts ORDER BY created_at DESC LIMIT 30').all();
      return json({ ok: true, items: results || [] });
    }

    if (action === 'contacts') {
      const { results } = await db.prepare(`SELECT p.phone AS phone, COALESCE(c.email, ae.email) AS email, c.whatsapp AS whatsapp,
        COALESCE(c.opt_email,1) AS opt_email, COALESCE(c.opt_whatsapp,1) AS opt_whatsapp, COALESCE(c.opt_push,1) AS opt_push,
        u.nom AS nom, u.prenom AS prenom, u.plan_label AS plan_label, u.classe AS classe, u.expiry_ts AS expiry_ts
        ${FROM} ORDER BY COALESCE(u.updated_at, 0) DESC LIMIT 5000`).all();
      return json({ ok: true, items: results || [] });
    }

    if (action === 'send') {
      const channels = { push: !!(body.channels && body.channels.push), email: !!(body.channels && body.channels.email), whatsapp: !!(body.channels && body.channels.whatsapp) };
      const title = String(body.title || '').trim().slice(0, 100);
      const text = String(body.body || '').trim().slice(0, 1500);
      const url = String(body.url || '').trim().slice(0, 300);
      if (!text) return json({ error: 'Le message est vide.' }, 400);
      if (!channels.push && !channels.email && !channels.whatsapp) return json({ error: 'Choisis au moins un canal.' }, 400);

      let id = String(body.broadcastId || '');
      if (!id) {
        id = 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
        const q0 = audienceSql(body.audience, '');
        const t = await db.prepare('SELECT COUNT(*) AS n ' + FROM + ' WHERE ' + q0.where).bind(...q0.binds).first();
        await db.prepare('INSERT INTO broadcasts (id, title, body, url, channels, audience, total, status, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
          .bind(id, title, text, url, JSON.stringify(channels), JSON.stringify(body.audience || {}), (t && t.n) || 0, 'en cours', Date.now()).run();
      }
      const batch = Math.max(1, Math.min(40, parseInt(env.NOTIF_BATCH, 10) || DEFAULT_BATCH));
      const q = audienceSql(body.audience, String(body.cursor || ''));
      const { results } = await db.prepare(`SELECT ${RECIPIENT_COLS} ${FROM} WHERE ${q.where} ORDER BY p.phone LIMIT ${batch}`).bind(...q.binds).all();
      const rows = results || [];
      const out = rows.length ? await deliverToRecipients(env, db, rows, { title, body: text, url }, channels) : { push: 0, email: 0, whatsapp: 0, failed: 0 };
      const done = rows.length < batch;
      await db.prepare(`UPDATE broadcasts SET push_sent = push_sent + ?, email_sent = email_sent + ?, wa_sent = wa_sent + ?, failed = failed + ?, status = ?, finished_at = ? WHERE id = ?`)
        .bind(out.push, out.email, out.whatsapp, out.failed, done ? 'terminé' : 'en cours', done ? Date.now() : null, id).run();
      const b = await db.prepare('SELECT * FROM broadcasts WHERE id = ?').bind(id).first();
      return json({ ok: true, broadcastId: id, processed: rows.length, cursor: rows.length ? rows[rows.length - 1].phone : String(body.cursor || ''), done, broadcast: b });
    }

    return json({ error: 'Action inconnue.' }, 400);
  } catch (err) {
    return json({ error: 'Erreur notifications : ' + err.message }, 500);
  }
}
