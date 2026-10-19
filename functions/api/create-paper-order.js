import { json, normalizePhone } from './_shared.js';
import { ensurePaperOrdersTable, getPaperConfig, paperBilling, paperPagesFor, PAPER_TYPES, loadCatalogue, orderFromRow, publicOrder, PRINT_RESUME_CLASSES, printResumesTotal } from './_paper.js';

/* Cloudflare Function — /api/create-paper-order (public)
   Enregistre une commande de fiches en version papier. Le paiement (facultatif, tout de suite ou plus tard) se fait
   ensuite via /api/pay-paper-order.
   Body : { classe, papier:'blanc'|'couleur', toutes?:bool, matieres:[clé,…], nomFiche, adresse, whatsapp }
   Le nombre de pages (arrondi à la centaine) et le total (20 F/page + ram blanc 2 500 F / ram couleur 5 000 F par 500 pages)
   sont recalculés ICI (jamais fournis par le navigateur). */
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const b = await request.json();
    const clean = (v, max) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
    if (b.kind === 'resumes') return await createResumesOrder(b, db, clean);
    const classe = clean(b.classe, 10);
    const papier = String(b.papier || '').trim().toLowerCase();
    const nomFiche = clean(b.nomFiche, 80);
    const adresse = clean(b.adresse, 240);
    const whatsapp = normalizePhone(b.whatsapp);
    // Mode de paiement choisi : 'manuel' (dépôt MTN déclaré par le client, à vérifier par l'équipe) ou 'auto' (FedaPay).
    const payMode = b.payMode === 'manuel' ? 'manuel' : (b.payMode === 'auto' ? 'auto' : null);
    if (!classe || !nomFiche || !adresse) return json({ error: 'Veuillez remplir tous les champs obligatoires.' }, 400);
    if (!PAPER_TYPES.includes(papier)) return json({ error: 'Choisissez le papier : ram blanc ou ram couleur.' }, 400);
    if (whatsapp.length < 8 || whatsapp.length > 15) return json({ error: 'Numéro WhatsApp invalide.' }, 400);

    const cat = await loadCatalogue(env, request);
    const classeCat = cat[classe];
    if (!classeCat) return json({ error: 'Classe invalide.' }, 400);
    let keys = b.toutes === true ? Object.keys(classeCat) : (Array.isArray(b.matieres) ? b.matieres.map(String) : []);
    keys = Array.from(new Set(keys)).filter(k => Object.prototype.hasOwnProperty.call(classeCat, k));
    if (!keys.length) return json({ error: 'Choisissez au moins une matière.' }, 400);
    const cfg = await getPaperConfig(db);
    // Pages de chaque matière ; total « à confirmer » si le nombre de pages d'une matière est inconnu.
    const matieres = [];
    for (const k of keys) {
      const count = Number(classeCat[k].count) || 0;
      const { pages } = await paperPagesFor(env, cfg, classe, k, count);
      matieres.push({ key: k, label: classeCat[k].matiereLabel || k, count, pages });
    }
    const nbFiches = matieres.reduce((s, m) => s + m.count, 0);
    const pagesKnown = matieres.every(m => m.pages);
    const bill = pagesKnown ? paperBilling(matieres.reduce((s, m) => s + m.pages, 0), papier) : null;
    const nbPages = bill ? bill.pages : null;   // pages facturées (arrondies à la centaine supérieure)
    const total = bill ? bill.total : null;
    const pricePerFiche = null;
    const matJson = JSON.stringify(matieres);

    await ensurePaperOrdersTable(db);
    // Double envoi (double clic, réseau lent) : même WhatsApp, même classe, mêmes matières dans les 2 dernières minutes.
    const recent = await db.prepare('SELECT * FROM paper_orders WHERE whatsapp = ? AND classe = ? AND matieres = ? AND papier = ? AND created_at > ? ORDER BY id DESC LIMIT 1')
      .bind(whatsapp, classe, matJson, papier, Date.now() - 2 * 60 * 1000).first();
    if (recent) return json({ ok: true, already: true, order: publicOrder(orderFromRow(recent)) });

    const now = Date.now();
    const res = await db.prepare(
      `INSERT INTO paper_orders (numero, classe, matieres, nb_fiches, papier, nb_pages, nom_fiche, adresse, whatsapp, unit_price, total, paid, status, created_at, updated_at, pay_mode, manual_declared)
       VALUES ('', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'nouvelle', ?, ?, ?, ?)`
    ).bind(classe, matJson, nbFiches, papier, nbPages, nomFiche, adresse, whatsapp, pricePerFiche, total, now, now, payMode, payMode === 'manuel' ? now : null).run();
    const id = res.meta.last_row_id;
    const numero = 'PAP-' + new Date(now).getFullYear() + '-' + String(id).padStart(4, '0');
    await db.prepare('UPDATE paper_orders SET numero = ? WHERE id = ?').bind(numero, id).run();

    const row = await db.prepare('SELECT * FROM paper_orders WHERE id = ?').bind(id).first();
    return json({ ok: true, order: publicOrder(orderFromRow(row)) });
  } catch (err) {
    return json({ error: "Erreur lors de l'enregistrement de la commande : " + err.message }, 500);
  }
}


/* Commande d'IMPRESSION des résumés + ressources didactiques (version cartonnée).
   Body : { kind:'resumes', classes:['CI','CP',…], items:[{classe, matiere}], adresse, whatsapp, payMode } */
async function createResumesOrder(b, db, clean) {
  const adresse = clean(b.adresse, 240);
  const whatsapp = normalizePhone(b.whatsapp);
  const payMode = b.payMode === 'manuel' ? 'manuel' : (b.payMode === 'auto' ? 'auto' : null);
  if (!adresse) return json({ error: 'Indiquez le lieu de livraison.' }, 400);
  if (whatsapp.length < 8 || whatsapp.length > 15) return json({ error: 'Numéro WhatsApp invalide.' }, 400);
  const classes = PRINT_RESUME_CLASSES.filter(c => Array.isArray(b.classes) && b.classes.map(String).includes(c));
  if (!classes.length) return json({ error: 'Choisissez au moins une classe.' }, 400);
  const matieres = [];
  const seen = new Set();
  for (const it of (Array.isArray(b.items) ? b.items.slice(0, 200) : [])) {
    const c = clean(it && it.classe, 10), m = clean(it && it.matiere, 80);
    if (!classes.includes(c) || !m || seen.has(c + '::' + m)) continue;
    seen.add(c + '::' + m);
    matieres.push({ key: c + '::' + m, label: c + ' — ' + m, classe: c, matiere: m, pages: null });
  }
  if (!classes.every(c => matieres.some(m => m.classe === c))) return json({ error: 'Choisissez au moins une matière pour chaque classe.' }, 400);
  const total = printResumesTotal(classes.length);
  const classeTxt = classes.join(', ');
  const matJson = JSON.stringify(matieres);
  const nomFiche = 'Client FicheProBot';

  await ensurePaperOrdersTable(db);
  const recent = await db.prepare("SELECT * FROM paper_orders WHERE kind = 'resumes' AND whatsapp = ? AND classe = ? AND matieres = ? AND created_at > ? ORDER BY id DESC LIMIT 1")
    .bind(whatsapp, classeTxt, matJson, Date.now() - 2 * 60 * 1000).first();
  if (recent) return json({ ok: true, already: true, order: publicOrder(orderFromRow(recent)) });

  const now = Date.now();
  const res = await db.prepare(
    `INSERT INTO paper_orders (numero, classe, matieres, nb_fiches, papier, nb_pages, nom_fiche, adresse, whatsapp, unit_price, total, paid, status, created_at, updated_at, pay_mode, manual_declared, kind)
     VALUES ('', ?, ?, 0, NULL, NULL, ?, ?, ?, NULL, ?, 0, 'nouvelle', ?, ?, ?, ?, 'resumes')`
  ).bind(classeTxt, matJson, nomFiche, adresse, whatsapp, total, now, now, payMode, payMode === 'manuel' ? now : null).run();
  const id = res.meta.last_row_id;
  const numero = 'IMP-' + new Date(now).getFullYear() + '-' + String(id).padStart(4, '0');
  await db.prepare('UPDATE paper_orders SET numero = ? WHERE id = ?').bind(numero, id).run();
  const row = await db.prepare('SELECT * FROM paper_orders WHERE id = ?').bind(id).first();
  return json({ ok: true, order: publicOrder(orderFromRow(row)) });
}
