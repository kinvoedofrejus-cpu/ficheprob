import { ensureNotifTables, deliverToRecipients, RECIPIENT_COLS } from './_notify.js';
import { GRATUIT_PLAN_INDEX } from './_shared.js';

/* Rappels automatiques (tâche planifiée Cloudflare, voir « [triggers] » dans wrangler.toml, toutes les heures) :
     - « expiry »  : abonnement payant qui expire dans moins de 3 jours ;
     - « expired » : abonnement payant expiré depuis moins de 2 jours.
   Un même rappel n'est jamais envoyé deux fois (table notif_log). Tous les comptes sont contactés, sauf ceux qui se sont désinscrits d'un canal.
   On ne travaille qu'entre 7 h et 19 h (heure du Bénin) et par petits lots (limite de requêtes sortantes d'une exécution). */
const PER_RUN = 12;
const DAY = 86400000;

export async function runReminders(env) {
  const db = env.FPB_DB;
  const hourBenin = (new Date().getUTCHours() + 1) % 24;
  if (hourBenin < 7 || hourBenin >= 19) return { skipped: 'hors horaires' };
  await ensureNotifTables(db);
  const now = Date.now();
  let left = PER_RUN, sent = 0;

  const jobs = [
    { kind: 'expiry', from: now, to: now + 3 * DAY, msg: (days) => ({
        title: 'Ton abonnement FicheProBot expire bientôt',
        body: 'Bonjour {prenom}, ton abonnement se termine dans ' + days + ' jour' + (days > 1 ? 's' : '') + '. Renouvelle-le pour continuer à élaborer tes fiches sans interruption.', url: '/' }) },
    { kind: 'expired', from: now - 2 * DAY, to: now, msg: () => ({
        title: 'Ton abonnement FicheProBot a expiré',
        body: 'Bonjour {prenom}, ton abonnement est arrivé à échéance. Renouvelle-le en quelques secondes pour retrouver toutes les fonctionnalités.', url: '/' }) }
  ];

  for (const job of jobs) {
    if (left <= 0) break;
    const { results } = await db.prepare(`SELECT ${RECIPIENT_COLS}, u.expiry_ts AS expiry_ts FROM users u JOIN (SELECT phone FROM users) p ON p.phone = u.phone
      LEFT JOIN contacts c ON c.phone = u.phone LEFT JOIN account_emails ae ON ae.phone = u.phone
      WHERE u.active = 1 AND u.plan_index != ? AND u.expiry_ts > ? AND u.expiry_ts <= ? AND (COALESCE(c.opt_email,1) = 1 OR COALESCE(c.opt_whatsapp,1) = 1 OR COALESCE(c.opt_push,1) = 1)
      AND NOT EXISTS (SELECT 1 FROM notif_log l WHERE l.phone = u.phone AND l.kind = ? AND l.ref = CAST(u.expiry_ts AS TEXT))
      LIMIT ${left}`).bind(GRATUIT_PLAN_INDEX, job.from, job.to, job.kind).all();
    for (const r of (results || [])) {
      const days = Math.max(1, Math.ceil((r.expiry_ts - now) / DAY));
      await deliverToRecipients(env, db, [r], job.msg(days), { push: true, email: true, whatsapp: true });
      await db.prepare('INSERT OR IGNORE INTO notif_log (phone, kind, ref, ts) VALUES (?,?,?,?)').bind(r.phone, job.kind, String(r.expiry_ts), now).run();
      left--; sent++;
    }
  }
  return { sent };
}
