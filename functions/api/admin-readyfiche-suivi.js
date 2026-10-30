import { requireAdmin, json, listTx, getReadyVersions, bumpReadyVersion, ensureEventsTable, readyFormatOfTx } from './_shared.js';

/* Cloudflare Function — /api/admin-readyfiche-suivi (29/10/2026)
   Suivi des Fiches Prêtes pour l'admin :
     - action 'stats'   : ventes (CA, achats, par classe / matière / format / jour), téléchargements, aperçus, taux aperçu -> achat ;
     - action 'versions': versions corrigées publiées ;
     - action 'bump'    : publie une version corrigée d'une matière (classe, matiere, note) : les acheteurs qui ont déjà téléchargé
                          retrouvent UN téléchargement gratuit de la nouvelle version.
   Aucune migration : lecture des tables existantes + table des compteurs créée au besoin. */
const DAY = 24 * 3600 * 1000;
const ymd = ts => new Date(ts).toISOString().slice(0, 10);

export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const body = await request.json();
    if (!(await requireAdmin(env, body.token))) return json({ ok: false, reason: 'invalid' }, 401);
    const action = String(body.action || 'stats');

    if (action === 'versions') return json({ ok: true, versions: await getReadyVersions(db) });

    if (action === 'bump') {
      const classe = String(body.classe || '').trim(), matiere = String(body.matiere || '').trim();
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(classe) || !/^[A-Za-z0-9_-]{1,60}$/.test(matiere)) return json({ ok: false, reason: 'invalid-params' }, 400);
      return json({ ok: true, version: await bumpReadyVersion(db, classe, matiere, body.note) });
    }

    if (action !== 'stats') return json({ ok: false, reason: 'invalid-params' }, 400);
    const days = Math.min(365, Math.max(1, Number(body.days) || 30));
    const since = Date.now() - days * DAY, sinceDay = ymd(since);

    // Ventes : transactions Fiche Prête payées dans la période
    const tx = (await listTx(db)).filter(t => t.type === 'readyfiche' && t.status === 'paid' && (t.paidAt || t.createdAt || 0) >= since);
    const sales = { total: 0, count: 0, byFormat: { pdf: { n: 0, amount: 0 }, word: { n: 0, amount: 0 } }, byTier: { matiere: { n: 0, amount: 0 }, classe: { n: 0, amount: 0 } }, byClasse: {}, byMatiere: {}, byDay: {} };
    tx.forEach(t => {
      const amt = Number(t.amount) || 0, isClasse = t.matiere === '*', fmt = readyFormatOfTx(t);
      sales.total += amt; sales.count++;
      sales.byFormat[fmt].n++; sales.byFormat[fmt].amount += amt;
      const tier = isClasse ? 'classe' : 'matiere'; sales.byTier[tier].n++; sales.byTier[tier].amount += amt;
      const c = sales.byClasse[t.classe] = sales.byClasse[t.classe] || { n: 0, amount: 0, forfait: 0 };
      c.n++; c.amount += amt; if (isClasse) c.forfait++;
      if (!isClasse) { const k = t.classe + '::' + t.matiere; const m = sales.byMatiere[k] = sales.byMatiere[k] || { n: 0, amount: 0 }; m.n++; m.amount += amt; }
      const d = ymd(t.paidAt || t.createdAt); const x = sales.byDay[d] = sales.byDay[d] || { n: 0, amount: 0 }; x.n++; x.amount += amt;
    });

    // Aperçus + téléchargements validés (compteurs)
    await ensureEventsTable(db);
    const { results } = await db.prepare('SELECT day, event, classe, matiere, n FROM readyfiche_events WHERE day >= ?').bind(sinceDay).all();
    const events = {};   // 'event|classe|matiere' -> n
    const evClasse = {}; // 'event|classe' -> n
    (results || []).forEach(r => {
      events[`${r.event}|${r.classe}|${r.matiere}`] = (events[`${r.event}|${r.classe}|${r.matiere}`] || 0) + r.n;
      evClasse[`${r.event}|${r.classe}`] = (evClasse[`${r.event}|${r.classe}`] || 0) + r.n;
    });

    return json({ ok: true, days, sales, events, evClasse });
  } catch (err) {
    return json({ error: 'Erreur : ' + err.message }, 500);
  }
}
