import { json, normalizePhone } from './_shared.js';
import { ensurePaperOrdersTable, getPaperConfig, loadCatalogue, orderFromRow, publicOrder } from './_paper.js';

/* Cloudflare Function — /api/create-paper-order (public)
   Enregistre une commande de fiches en version papier. Le paiement (facultatif, tout de suite ou plus tard) se fait
   ensuite via /api/pay-paper-order.
   Body : { classe, toutes?:bool, matieres:[clé,…], nomFiche, adresse, whatsapp }
   Le nombre de fiches et le total sont recalculés ICI à partir du catalogue (jamais fournis par le navigateur). */
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const b = await request.json();
    const clean = (v, max) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, max);
    const classe = clean(b.classe, 10);
    const nomFiche = clean(b.nomFiche, 80);
    const adresse = clean(b.adresse, 240);
    const whatsapp = normalizePhone(b.whatsapp);
    if (!classe || !nomFiche || !adresse) return json({ error: 'Veuillez remplir tous les champs obligatoires.' }, 400);
    if (whatsapp.length < 8 || whatsapp.length > 15) return json({ error: 'Numéro WhatsApp invalide.' }, 400);

    const cat = await loadCatalogue(env, request);
    const classeCat = cat[classe];
    if (!classeCat) return json({ error: 'Classe invalide.' }, 400);
    let keys = b.toutes === true ? Object.keys(classeCat) : (Array.isArray(b.matieres) ? b.matieres.map(String) : []);
    keys = Array.from(new Set(keys)).filter(k => Object.prototype.hasOwnProperty.call(classeCat, k));
    if (!keys.length) return json({ error: 'Choisissez au moins une matière.' }, 400);
    const matieres = keys.map(k => ({ key: k, label: classeCat[k].matiereLabel || k, count: Number(classeCat[k].count) || 0 }));
    const nbFiches = matieres.reduce((s, m) => s + m.count, 0);

    const { pricePerFiche } = await getPaperConfig(db);
    const total = pricePerFiche ? pricePerFiche * nbFiches : null;
    const matJson = JSON.stringify(matieres);

    await ensurePaperOrdersTable(db);
    // Double envoi (double clic, réseau lent) : même WhatsApp, même classe, mêmes matières dans les 2 dernières minutes.
    const recent = await db.prepare('SELECT * FROM paper_orders WHERE whatsapp = ? AND classe = ? AND matieres = ? AND created_at > ? ORDER BY id DESC LIMIT 1')
      .bind(whatsapp, classe, matJson, Date.now() - 2 * 60 * 1000).first();
    if (recent) return json({ ok: true, already: true, order: publicOrder(orderFromRow(recent)) });

    const now = Date.now();
    const res = await db.prepare(
      `INSERT INTO paper_orders (numero, classe, matieres, nb_fiches, nom_fiche, adresse, whatsapp, unit_price, total, paid, status, created_at, updated_at)
       VALUES ('', ?, ?, ?, ?, ?, ?, ?, ?, 0, 'nouvelle', ?, ?)`
    ).bind(classe, matJson, nbFiches, nomFiche, adresse, whatsapp, pricePerFiche, total, now, now).run();
    const id = res.meta.last_row_id;
    const numero = 'PAP-' + new Date(now).getFullYear() + '-' + String(id).padStart(4, '0');
    await db.prepare('UPDATE paper_orders SET numero = ? WHERE id = ?').bind(numero, id).run();

    const row = await db.prepare('SELECT * FROM paper_orders WHERE id = ?').bind(id).first();
    return json({ ok: true, order: publicOrder(orderFromRow(row)) });
  } catch (err) {
    return json({ error: "Erreur lors de l'enregistrement de la commande : " + err.message }, 500);
  }
}
