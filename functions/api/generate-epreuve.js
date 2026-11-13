import { json, normalizePhone, getUser, getTierLimits, getTierLimitsByDays, tierLimitFor, tierPeriodKey, tierUsageKind, ensureDownloadTables } from './_shared.js';
import { AI_EPREUVE_MODELS, AI_STALL_MS, runParams, aiText } from './_ai.js';

// Cloudflare Function — /api/generate-epreuve
//
// Onglet « Épreuves » : génère une épreuve d'activité d'intégration (hors mathématiques, qui sont calculées
// directement dans le navigateur pour que le corrigé soit toujours exact).
//   requête  { type, classe, mois, resumes:[{titre,texte}], notions, seed }
//   type     'ee' (expression écrite) | 'lecture' | 'es' | 'est' | 'dessin'
//   réponse  { ok:true, epreuve:{ support:{titre,texte}, tache, items:[{intro,figure,questions[]}], consigne[], corrige[] } }
// Les modèles sont essayés dans l'ordre ; le suivant démarre si le précédent échoue ou tarde (STALL).
// Modèles et délai : écrits dans _ai.js (AI_EPREUVE_MODELS, AI_STALL_MS).

const MODEL_TIMEOUT_MS = 50000;

// Ordre des modèles écrit dans _ai.js (AI_EPREUVE_MODELS) : GPT-OSS 120B, puis DeepSeek V4.1 Flash, puis Llama 3.3 70B en secours.
const models = () => AI_EPREUVE_MODELS;

const sleep = ms => new Promise(r => setTimeout(r, ms));
// Vrai seulement pour l'épuisement du forfait quotidien Workers AI (code 4006 / « neurons »).
// Une saturation passagère (« capacity », 429, 3040, délai…) n'est PAS un dépassement de limite : on réessaie.
const isDailyQuota = e => /4006|daily|neurons?/i.test(String((e && e.message) || e || ''));

// Deux tours : si tous les modèles échouent vite (saturation passagère, JSON inexploitable), on refait un tour.
async function runChain(env, params, accept) {
  const t0 = Date.now();
  try {
    return await runChainOnce(env, params, accept);
  } catch (e) {
    if (isDailyQuota(e) || Date.now() - t0 > 30000) throw e;
    await sleep(2500);
    return await runChainOnce(env, params, accept);
  }
}

async function runChainOnce(env, params, accept) {
  const list = models();
  const stallMs = AI_STALL_MS;
  return new Promise((resolve, reject) => {
    let started = 0, ended = 0, done = false, lastErr = null, stallTimer = null;
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(stallTimer); fn(v); };
    const launchNext = () => {
      if (done || started >= list.length) return;
      const model = list[started++];
      clearTimeout(stallTimer);
      if (started < list.length) stallTimer = setTimeout(launchNext, stallMs);
      let t;
      Promise.race([
        Promise.resolve().then(() => env.AI.run(model, runParams(model, params))),
        new Promise((_, rej) => { t = setTimeout(() => rej(new Error('délai dépassé')), MODEL_TIMEOUT_MS); })
      ]).then(result => {
        clearTimeout(t);
        const text = aiText(result);
        const parsed = text.trim() ? accept(text) : null;
        if (parsed) { finish(resolve, parsed); return; }
        throw new Error('réponse invalide');
      }).catch(err => {
        clearTimeout(t);
        lastErr = err; ended++;
        if (done) return;
        if (ended >= list.length) { finish(reject, lastErr || new Error('IA indisponible')); return; }
        if (started < list.length) launchNext();
      });
    };
    launchNext();
  });
}

// Extrait le premier objet JSON d'un texte (les modèles ajoutent parfois du texte, des ``` ou des retours à la
// ligne dans les chaînes) ; une réponse tronquée est refermée au mieux plutôt que perdue.
function closeJson(t) {
  const stack = []; let inStr = false, esc = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inStr) { if (esc) esc = false; else if (ch === '\\') esc = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  return t + (inStr ? '"' : '') + stack.reverse().join('');
}
function extractJson(text) {
  const s = String(text || '').replace(/```json|```/gi, '').replace(/[\u0000-\u001f]+/g, ' ');
  const start = s.indexOf('{');
  if (start < 0) return null;
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') depth++;
    else if (ch === '}' || ch === ']') {
      depth--;
      if (depth === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch (e) { break; } }
    }
  }
  // Réponse tronquée ou mal fermée : on recule jusqu'à la dernière virgule exploitable et on referme.
  let t = s.slice(start);
  for (let k = 0; k < 10 && t.length > 2; k++) {
    try { return JSON.parse(closeJson(t.replace(/[,:\s]+$/, ''))); } catch (e) { /* on recule */ }
    const c = t.lastIndexOf(',');
    if (c < 0) break;
    t = t.slice(0, c);
  }
  return null;
}

const cleanStr = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 600);
const cleanArr = (a, max, n) => (Array.isArray(a) ? a : []).map(x => cleanStr(x, max)).filter(Boolean).slice(0, n || 12);

// Fil conducteur propre à chaque épreuve (tiré de la graine envoyée par l'application, différente à chaque
// génération) : mille enseignants qui choisissent la même classe, la même matière et les mêmes SA obtiennent
// des épreuves différentes (décor, prénoms, forme de la situation).
const DECORS = ["le marché du village", "la cour de l'école pendant la récréation", "le champ de la famille", "une partie de pêche au bord du fleuve", "la cuisine de la maison", "un match de football du quartier", "la fête de fin d'année à l'école", "l'atelier du menuisier", "le jardin scolaire", "un voyage en car vers la ville", "la boutique du quartier", "la ferme et ses animaux", "la forêt après la pluie", "le puits du village", "une cérémonie en famille", "la bibliothèque de l'école", "l'atelier de la couturière", "le potager de grand-mère", "le marché aux poissons", "le chemin de l'école", "une journée de nettoyage du quartier", "la cantine de l'école", "la pharmacie du village", "la rivière en saison des pluies", "la visite d'un artisan à l'école", "la préparation d'un repas de fête", "le centre de santé du village", "la réunion des parents d'élèves"];
const SITUATIONS = ["une petite histoire racontée par le maître", "un problème de la vie courante", "un court dialogue entre deux élèves", "l'observation d'un objet apporté en classe", "un projet de classe", "une enquête menée par les élèves", "un défi lancé à la classe", "une exposition préparée par les élèves", "le souvenir d'un événement vécu", "une affiche ou un message trouvé à l'école"];
const PRENOMS = ["Koffi", "Afi", "Sènami", "Comlan", "Fifamè", "Dossou", "Aïcha", "Mariama", "Codjo", "Adjoa", "Ismaël", "Roukayath", "Gbèdji", "Honorine", "Prisca", "Séraphin", "Nadège", "Ayaba", "Kokou", "Estelle", "Armand", "Zouera", "Yannick", "Mawulé", "Chimène", "Basile", "Fatoumata", "Dieudonné", "Reine", "Habib", "Judith", "Samuel", "Rachidatou", "Gildas", "Sabine", "Moussa"];
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function variation(seed) {
  const rnd = mulberry32((Number(seed) || 1) * 2654435761);
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const a = pick(PRENOMS); let b = pick(PRENOMS); while (b === a) b = pick(PRENOMS);
  return { decor: pick(DECORS), situation: pick(SITUATIONS), a, b };
}

/* ---------- Limite quotidienne : 3 épreuves maximum par jour et par utilisateur ----------
   Compteur dans D1 (table créée au premier appel). Réservation atomique AVANT la rédaction, remboursée si la
   rédaction échoue : une saturation de l'IA ne consomme jamais l'une des 3 épreuves.
   Clé : le numéro du compte s'il est valide, sinon l'identifiant de l'appareil, sinon l'adresse IP.
   Limite écrite dans le code (DAILY_LIMIT). Le compte propriétaire n'est pas limité. */
const OWNER_PHONE = '0166661846', OWNER_CODE = 'KINVOS';
const dayKey = () => new Date(Date.now() + 3600000).toISOString().slice(0, 10);   // jour du Bénin (UTC+1)
const DAILY_LIMIT = 3;   // épreuves maximum par jour et par utilisateur
const FICHE_DAILY_LIMIT = 12;   // activités de la « Fiche d'intégration » : compteur à part, pour ne pas consommer les 3 épreuves du jour
function dailyLimit(scope) { return scope === 'fiche' ? FICHE_DAILY_LIMIT : DAILY_LIMIT; }

async function quotaKey(env, request, body) {
  const phone = normalizePhone(body.phone), code = String(body.code || '').trim().toUpperCase();
  if (phone.length >= 8 && code) {
    if (phone === normalizePhone(OWNER_PHONE) && code === OWNER_CODE) return { unlimited: true };
    try {
      const u = await getUser(env.FPB_DB, phone);
      if (u && String(u.code || '').toUpperCase() === code && u.active) return { key: 'p:' + phone, user: u, phone };
    } catch (e) { /* on retombe sur l'appareil */ }
  }
  const dev = cleanStr(body.deviceId, 80);
  if (dev) return { key: 'd:' + dev };
  return { key: 'ip:' + (request.headers.get('CF-Connecting-IP') || 'inconnu') };
}
async function quotaReady(db) {
  await db.prepare('CREATE TABLE IF NOT EXISTS epreuve_usage (k TEXT NOT NULL, day TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (k, day))').run();
}
// Réserve une épreuve : { ok:true, release() } ou { ok:false, used, limit }.
async function quotaTake(env, request, body, scope) {
  if (!env.FPB_DB) return { ok: true, release: async () => {} };   // pas de base : pas de limite (jamais bloquant)
  try {
    const who = await quotaKey(env, request, body);
    if (who.unlimited) return { ok: true, release: async () => {} };
    /* Compte connecté : la limite est celle de son NIVEAU (accès « Génération d'épreuves par jour » réglé par l'admin).
       -1 = illimité ; 0 = non inclus. Les activités de la Fiche d'intégration (scope 'fiche') gardent leur compteur à part. */
    if (who.user && scope !== 'fiche') {
      await ensureDownloadTables(env.FPB_DB);
      const limits = await getTierLimits(env.FPB_DB);
      const byDays = await getTierLimitsByDays(env.FPB_DB);
      const tl = tierLimitFor(limits, who.user, 'epreuve', byDays);
      if (tl < 0) return { ok: true, release: async () => {} };
      if (tl === 0) return { ok: false, used: 0, limit: 0, notInTier: true };
      const kind = tierUsageKind('epreuve'), ref = tierPeriodKey('epreuve', who.user);
      const r2 = await env.FPB_DB.prepare('INSERT INTO download_usage (owner, kind, ref, n) VALUES (?, ?, ?, 1) ON CONFLICT(owner, kind, ref) DO UPDATE SET n = n + 1 WHERE n < ?')
        .bind(who.phone, kind, ref, tl).run();
      if (!(r2 && r2.meta && r2.meta.changes > 0)) return { ok: false, used: tl, limit: tl };
      return { ok: true, release: async () => { try { await env.FPB_DB.prepare('UPDATE download_usage SET n = MAX(n - 1, 0) WHERE owner = ? AND kind = ? AND ref = ?').bind(who.phone, kind, ref).run(); } catch (e) {} } };
    }
    await quotaReady(env.FPB_DB);
    const limit = dailyLimit(scope), day = dayKey();
    if (scope === 'fiche') who.key += '|fiche';
    const r = await env.FPB_DB.prepare('INSERT INTO epreuve_usage (k, day, n) VALUES (?, ?, 1) ON CONFLICT(k, day) DO UPDATE SET n = n + 1 WHERE n < ?')
      .bind(who.key, day, limit).run();
    if (!(r && r.meta && r.meta.changes > 0)) return { ok: false, used: limit, limit };
    return { ok: true, release: async () => { try { await env.FPB_DB.prepare('UPDATE epreuve_usage SET n = MAX(n - 1, 0) WHERE k = ? AND day = ?').bind(who.key, day).run(); } catch (e) {} } };
  } catch (e) {
    console.error('quota epreuve:', e && e.message);
    return { ok: true, release: async () => {} };   // en cas de souci technique, on ne bloque pas l'enseignant
  }
}

const FIGURES = ['serie', 'derivation', 'circuit', 'montages'];

// Réduit la réponse de l'IA à la forme attendue et refuse (null) ce qui est inutilisable.
const LECT_MIN = { CI: 70, CP: 110, CE1: 160, CE2: 200, CM1: 230, CM2: 250 };
function normalize(type, raw, classe) {
  if (!raw || typeof raw !== 'object') return null;
  const out = {
    support: {
      titre: cleanStr(raw.support && raw.support.titre, 120),
      texte: cleanStr(raw.support && raw.support.texte, type === 'lecture' ? 1400 : 900)
    },
    tache: cleanStr(raw.tache, 400),
    items: [],
    consigne: cleanArr(raw.consigne, 300, 8),
    corrige: []
  };
  const rawItems = Array.isArray(raw.items) ? raw.items : [];
  for (const it of rawItems.slice(0, 4)) {
    const qs = cleanArr(it && it.questions, 420, 6);
    if (!qs.length) continue;
    const fig = FIGURES.includes(it.figure) ? it.figure : '';
    out.items.push({ intro: cleanStr(it.intro, 700), figure: (type === 'est' && (classe === 'CM1' || classe === 'CM2')) ? fig : '', questions: qs });
  }
  const rawCor = Array.isArray(raw.corrige) ? raw.corrige : [];
  out.corrige = rawCor.slice(0, 5).map(c => ({ item: cleanStr(c && c.item, 20), lignes: cleanArr(c && c.lignes, 500, 8) })).filter(c => c.lignes.length);

  if (!out.support.texte || !out.tache) return null;
  // Qualité minimale : chaque question est assez développée et chaque item a son corrigé complet (une ligne par question).
  const minQ = (classe === 'CI' || classe === 'CP') ? 12 : 25;
  const qualite = () => type === 'dessin' || (out.items.every((it, i) => {
    const c = out.corrige[i];
    return c && c.lignes.length >= it.questions.length && it.questions.every(q => q.length >= minQ);
  }));
  if (type === 'dessin') return out.consigne.length >= 2 ? out : null;
  if (type === 'ee') return out.items.length >= 1 && out.items[0].questions.length >= 2 ? (out.items = out.items.slice(0, 1), qualite() ? out : null) : null;
  if (out.items.length < 3) return null;
  out.items = out.items.slice(0, 3);
  if (type === 'lecture' && out.support.texte.length < (LECT_MIN[classe] || 200)) return null;
  return qualite() ? out : null;
}

// Types de textes étudiés en CM2 dans les fiches prêtes d'expression écrite.
const TEXTES = {
  portrait: { nom: 'le portrait', guide: `Support = une situation où l'élève doit faire le portrait d'une personne de son entourage (camarade, grand-parent, commerçant du marché, maître…). Questions : A = présente la personne (nom, âge, métier ou lien avec toi) ; B = décris son portrait physique et moral en (nombre maximum) phrases ; C = termine par ce que tu penses d'elle.` },
  affiche: { nom: "l'affiche", guide: `Support = une situation de la vie de l'école ou du village qui demande de sensibiliser ou d'informer (propreté, hygiène, kermesse, vaccination…). Questions : A = donne un titre à ton affiche ; B = rédige un message de (nombre maximum) phrases ; C = termine par un slogan adapté.` },
  narration: { nom: 'la narration', guide: `Support = une situation qui invite à raconter un événement vécu ou imaginé. Questions : A = présente la situation initiale (personnages, lieu, moment) ; B = raconte le déroulement des événements en (nombre maximum) phrases ; C = écris la fin de l'histoire.` },
  lettre: { nom: 'la lettre personnelle', guide: `Support = une situation où l'élève écrit à un proche (parent, ami, cousin) pour donner des nouvelles, remercier, inviter ou consoler. Questions : A = écris le lieu, la date et la formule d'appel ; B = rédige le corps de la lettre en (nombre maximum) phrases ; C = termine par la formule de politesse et la signature.` },
  compte: { nom: 'le compte rendu', guide: `Support = un événement ou une activité vécue à l'école (visite, séance de travail, fête, expérience) dont l'élève doit rendre compte. Questions : A = donne un titre et précise qui, où et quand ; B = rédige le compte rendu dans l'ordre des faits en (nombre maximum) phrases ; C = termine par ton appréciation.` },
  conte: { nom: 'le conte', guide: `Support = une situation qui invite à écrire un conte (personnages, lieu, problème à résoudre, animaux qui parlent). Questions : A = commence ton conte par une formule d'ouverture et présente les personnages ; B = raconte l'histoire en (nombre maximum) phrases ; C = termine par la fin du conte et la morale.` },
  article: { nom: "l'article de journal", guide: `Support = un événement de la vie de l'école ou de la commune dont le journal scolaire veut parler. Questions : A = donne un titre accrocheur à ton article ; B = rédige l'article en (nombre maximum) phrases en répondant à : qui ? quoi ? où ? quand ? pourquoi ? ; C = termine par un conseil ou une conclusion et signe.` },
  admin: { nom: 'la lettre administrative', guide: `Support = une situation où l'élève ou ses parents doivent écrire à une autorité (directeur, inspecteur, maire) pour demander, informer ou s'excuser. Questions : A = écris l'en-tête (expéditeur, destinataire, lieu, date et objet) ; B = rédige le corps de la lettre en (nombre maximum) phrases ; C = termine par la formule de politesse et la signature.` }
};

const TYPES = {
  ee: {
    label: 'FRANÇAIS — EXPRESSION ÉCRITE',
    forme: `UN SEUL item. Support = une situation de la vie de l'élève (école, famille, village) qui appelle une production écrite (affiche, lettre, compte rendu, description, récit, dialogue, invitation, consigne…). Tâche = « Tu es chargé(e) de… ». Les 3 questions A, B, C guident la production : A (titre ou formule d'ouverture), B (rédaction en un nombre maximum de phrases, à préciser), C (conclusion : slogan, formule de politesse, morale…).`,
    structure: `{"support":{"titre":"","texte":"…"},"tache":"Tu es chargé(e) de …","items":[{"intro":"","questions":["A. …","B. …","C. …"]}],"corrige":[{"item":"Item 1","lignes":["A. critères attendus …","B. …","C. …"]}]}`
  },
  lecture: {
    label: 'FRANÇAIS — LECTURE',
    forme: `Support = un TEXTE SUIVI (titre + 8 à 10 phrases, 90 à 130 mots) mettant en scène un personnage et un message éducatif lié à la vie de l'élève ; mets le texte dans support.texte et son titre dans support.titre. Tâche = « Lis le texte puis réponds aux questions. ». 3 items de 3 questions A, B, C : item 1 = compréhension du texte (retrouver une information, relever deux éléments, relever deux qualités) ; item 2 = langue (type de texte, phrase simple/complexe, transformation d'une phrase de la leçon : impératif, pluriel, temps…) ; item 3 = orthographe/grammaire (compléter par des homophones ou accorder, puis une question de réflexion « Explique pourquoi… », puis un conseil à donner).`,
    structure: `{"support":{"titre":"…","texte":"…"},"tache":"Lis le texte puis réponds aux questions.","items":[{"intro":"","questions":["A. …","B. …","C. …"]},{"intro":"","questions":["A. …","B. …","C. …"]},{"intro":"","questions":["A. …","B. …","C. …"]}],"corrige":[{"item":"Item 1","lignes":["A. …","B. …","C. …"]}]}`
  },
  es: {
    label: 'ÉDUCATION SOCIALE (ES)',
    forme: `Support = une situation courte (exposition, projet de classe, visite…) qui relie les trois items. Tâche = « Réponds aux questions suivantes en utilisant tes connaissances. ». 3 items de 4 questions A, B, C, D, chacun sur une partie des résumés fournis (histoire, géographie, civisme, morale…). Questions précises : définir, citer, situer, nommer, expliquer. N'invente aucun fait historique ou chiffre incertain ; reste dans les résumés.`,
    structure: `{"support":{"titre":"","texte":"…"},"tache":"Réponds aux questions suivantes en utilisant tes connaissances.","items":[{"intro":"","questions":["A. …","B. …","C. …","D. …"]},{"intro":"","questions":["A. …","B. …","C. …","D. …"]},{"intro":"","questions":["A. …","B. …","C. …","D. …"]}],"corrige":[{"item":"Item 1","lignes":["A. …","B. …","C. …","D. …"]}]}`
  },
  est: {
    label: 'ÉDUCATION SCIENTIFIQUE ET TECHNOLOGIQUE (EST)',
    forme: `Support = une situation d'expérience ou d'exposition scientifique liée aux résumés fournis. Tâche = « Aide les élèves à expliquer les expériences réalisées. ». 3 items de 3 questions A, B, C (cite, explique, nomme, calcule, représente par un schéma). Un item peut avoir un « intro » (courte situation expérimentale). Si un item concerne des circuits électriques à lampes, mets "figure":"montages" (montage A = lampes sur une même boucle, montage B = une lampe par branche, dessinés côte à côte) ou "figure":"serie" ou "figure":"derivation" (un seul montage) : le logiciel dessine lui-même la figure, ne la décris pas. Si un calcul est demandé (tension, masse, durée…), donne des valeurs simples et exactes dans l'intro.`,
    structure: `{"support":{"titre":"","texte":"…"},"tache":"Aide les élèves à expliquer les expériences réalisées.","items":[{"intro":"","figure":"","questions":["A. …","B. …","C. …"]},{"intro":"…","figure":"","questions":["A. …","B. …","C. …"]},{"intro":"…","figure":"","questions":["A. …","B. …","C. …"]}],"corrige":[{"item":"Item 1","lignes":["A. …","B. …","C. …"]}]}`
  },
  dessin: {
    label: 'DESSIN',
    forme: `Support = une situation (clé : « Situation ») liée à la vie de l'école ou du village. Tâche = « Réalise un dessin illustrant… ». Consigne = 4 à 5 éléments précis à représenter (personnages avec leur action, objets, décor), chacun dans un élément du tableau « consigne », puis une dernière phrase du type « Respecte les proportions, organise les éléments dans l'espace et colorie soigneusement ton dessin. ». Pas d'items.`,
    structure: `{"support":{"titre":"","texte":"…"},"tache":"Réalise un dessin illustrant …","items":[],"consigne":["deux élèves en train de …","…","…","Respecte les proportions, organise les éléments dans l'espace et colorie soigneusement ton dessin."],"corrige":[{"item":"Critères","lignes":["…"]}]}`
  }
};

const PROFILS = {
  CI:  { age: "6 ans, début de l'apprentissage de la lecture", style: "phrases de 4 à 7 mots, mots très courts et familiers, une seule consigne par question avec un seul verbe d'action (« Entoure », « Recopie », « Complète », « Relie », « Dis »)", texte: '4 à 5 phrases très courtes (30 à 45 mots)', prod: '1 à 2 phrases', nq: '2 à 3 questions par item' },
  CP:  { age: "7 ans, lecture et écriture en cours d'acquisition", style: "phrases de 6 à 10 mots, vocabulaire courant, consignes courtes à un seul verbe", texte: '5 à 6 phrases courtes (45 à 70 mots)', prod: '2 à 3 phrases', nq: '3 questions par item' },
  CE1: { age: '8 ans', style: 'phrases simples et courtes, vocabulaire courant, consignes à une seule tâche', texte: '6 à 8 phrases (70 à 100 mots)', prod: '3 à 4 phrases', nq: '3 questions par item' },
  CE2: { age: '9 ans', style: 'phrases simples ou à deux propositions, vocabulaire courant enrichi de quelques mots nouveaux étudiés', texte: '8 à 10 phrases (100 à 130 mots)', prod: '4 à 5 phrases', nq: '3 questions par item' },
  CM1: { age: '10 ans', style: 'phrases variées, vocabulaire plus riche, consignes pouvant demander de justifier ou d\'expliquer', texte: '9 à 11 phrases (120 à 160 mots)', prod: '5 à 6 phrases', nq: '3 questions par item' },
  CM2: { age: '11 ans, fin du cycle primaire (préparation au CEP)', style: 'phrases complexes possibles, vocabulaire riche, consignes demandant de raisonner, justifier, transformer', texte: '10 à 12 phrases (140 à 180 mots)', prod: '6 à 8 phrases', nq: '3 questions par item' }
};
const NIVEAUX = {
  1: "début de programme : reste sur les notions les plus récentes des résumés ; questions directes, une ou deux demandant de réfléchir.",
  2: "milieu de programme : mélange de questions directes et de questions de réflexion ; chaque item contient au moins une question qui demande d'expliquer, de justifier ou de transformer.",
  3: "programme bien avancé : épreuve plus exigeante ; chaque item contient une question de raisonnement ou de transfert (situation nouvelle, justification, comparaison) en plus des questions directes ; croise plusieurs notions des résumés."
};
function lectureForme(classe) {
  const pf = PROFILS[classe] || PROFILS.CM2;
  const base = `Support = un TEXTE SUIVI (titre + ${pf.texte}) mettant en scène un personnage et un message éducatif lié à la vie de l'élève ; mets le texte dans support.texte et son titre dans support.titre. Tâche = « Lis le texte puis réponds aux questions. ». 3 items de questions A, B, C (${pf.nq}) : `;
  if (classe === 'CI' || classe === 'CP') {
    return base + `item 1 = compréhension du texte (« Qui… ? », « Où… ? », « Que fait… ? », vrai ou faux, retrouver une information) ; item 2 = lecture et vocabulaire (relève dans le texte un mot qui contient le son étudié, trouve le mot qui veut dire…, remets les mots dans l'ordre pour faire une phrase) ; item 3 = écriture et orthographe (complète le mot avec la bonne syllabe ou le bon son, copie une phrase du texte, écris une phrase avec un mot donné).`;
  }
  if (classe === 'CE1' || classe === 'CE2') {
    return base + `item 1 = compréhension du texte (retrouver une information, relever deux éléments, expliquer pourquoi le personnage agit ainsi) ; item 2 = langue (type de phrase, nom ou verbe, singulier/pluriel, transformation d'une phrase du texte : pluriel, négation, temps) ; item 3 = orthographe/grammaire (compléter par des homophones étudiés ou accorder, puis une question « Explique pourquoi… », puis un conseil à donner).`;
  }
  return base + `item 1 = compréhension du texte (retrouver une information, relever deux éléments, relever deux qualités, déduire une idée non écrite) ; item 2 = langue (type de texte, phrase simple/complexe, transformation d'une phrase de la leçon : impératif, pluriel, temps…) ; item 3 = orthographe/grammaire (compléter par des homophones ou accorder, puis une question de réflexion « Explique pourquoi… », puis un conseil à donner).`;
}

function buildPrompt(type, classe, mois, resumes, notions, seed, texteType, niveau) {
  const pf = PROFILS[classe] || PROFILS.CM2;
  const forme = type === 'lecture' ? lectureForme(classe) : TYPES[type].forme;
  const T = TYPES[type];
  const tx = type === 'ee' ? TEXTES[texteType] : null;
  const v = variation(seed);
  const doc = resumes.map((r, i) => `[${i + 1}] ${r.titre}\n${r.texte}`).join('\n\n');
  return `Tu es un(e) conseiller(ère) pédagogique du primaire au Bénin. Tu conçois l'ÉVALUATION DU MOIS DE ${mois} (situation d'intégration, approche par les compétences) pour la classe de ${classe}, matière : ${T.label}.

CONTENUS DÉJÀ ENSEIGNÉS (résumés de cours — l'épreuve ne doit porter QUE sur ces notions, pas sur d'autres) :
${doc || '(aucun résumé fourni)'}
${notions ? `\nNotions supplémentaires indiquées par l'enseignant : ${notions}\n` : ''}
NIVEAU DE LA CLASSE (${classe}, élèves de ${pf.age}) : ${pf.style}. Quand la production est écrite par l'élève, elle fait ${pf.prod}.
AVANCEMENT DANS LE PROGRAMME : ${NIVEAUX[niveau] || NIVEAUX[2]}
DIFFICULTÉ : c'est une ÉVALUATION SÉRIEUSE, pas un simple exercice d'application. Dans CHAQUE item : au moins une question directe (restituer, relever, définir, nommer), au moins une question d'application (utiliser la notion dans un cas précis) et au moins une question de raisonnement (expliquer, justifier, comparer, transformer, résoudre une situation nouvelle en plusieurs étapes). INTERDIT : une question dont la réponse tient en un mot sans réflexion, un « oui/non » sans justification, une question qui se répond en recopiant le support. L'épreuve reste dans le programme de ${classe} et à la portée d'un élève moyen qui a étudié les résumés.
COUVERTURE : répartis les questions sur des notions DIFFÉRENTES des résumés (le plus grand nombre possible, en priorité les plus importantes) ; ne répète pas la même notion d'une question à l'autre.

FORME DE L'ÉPREUVE :
${forme}
${tx ? `
TYPE DE TEXTE IMPOSÉ : ${tx.nom}. La production demandée à l'élève doit être exactement ce type de texte, pas un autre.
${tx.guide}
` : ''}
RÈGLES :
- Contexte béninois, vie de l'élève (école, famille, village, marché, santé, environnement). Vocabulaire adapté au ${classe}, tutoiement dans les consignes.
- Une seule situation cohérente reliant toutes les questions ; les questions se répondent sur le papier, sans matériel.
- Chaque question doit pouvoir être corrigée avec certitude : pas de question ambiguë, aucun fait incertain.
- Ne recopie pas les résumés mot pour mot ; invente une situation nouvelle.
- FIL CONDUCTEUR IMPOSÉ (pour que cette épreuve ne ressemble pas à celles des autres enseignants) : décor = ${v.decor} ; forme de la mise en situation = ${v.situation} ; personnages = ${v.a} et ${v.b}. Le décor n'est qu'un habillage : les questions portent toujours sur les notions des résumés.
- Consignes légèrement développées : chaque question est une phrase complète et précise (ce qu'il faut faire, sur quoi), sans être longue ; pas de question vague.
- « corrige » : le CORRIGÉ TYPE = les réponses attendues, courtes et précises, une ligne par question (pour le dessin : les critères de réussite). Aucun barème, aucune note, aucun nombre de points.

Réponds UNIQUEMENT par un objet JSON valide, sans texte avant ni après, sans bloc de code, exactement de cette forme :
${T.structure}`;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    if (!env.AI) return json({ ok: false, reason: 'ai-unavailable' }, 501);
    const body = await request.json();
    const type = String(body.type || '');
    if (body.claim === true && type === 'maths') {   // maths : rien à rédiger ici, on ne fait que compter
      const t = await quotaTake(env, request, body);
      return t.ok ? json({ ok: true }) : json({ ok: false, reason: 'limit', limit: t.limit, notInTier: !!t.notInTier }, 429);
    }
    if (!TYPES[type]) return json({ ok: false, reason: 'invalid-params' }, 400);
    const classe = PROFILS[cleanStr(body.classe, 20)] ? cleanStr(body.classe, 20) : 'CM2';
    const mois = cleanStr(body.mois, 40) || '';
    const notions = cleanStr(body.notions, 400);
    const texteType = TEXTES[body.texteType] ? body.texteType : 'affiche';
    const seed = Math.abs(parseInt(body.seed, 10) || Date.now() % 1000);
    const niveau = Math.min(3, Math.max(1, parseInt(body.niveau, 10) || 2));
    const resumes = (Array.isArray(body.resumes) ? body.resumes : []).slice(0, 20).map(r => ({
      titre: cleanStr(r && r.titre, 140),
      texte: cleanStr(r && r.texte, 600)
    })).filter(r => r.titre);
    if (!resumes.length && !notions) return json({ ok: false, reason: 'no-content' }, 400);

    const taken = await quotaTake(env, request, body, body.scope === 'fiche' ? 'fiche' : '');
    if (!taken.ok) return json({ ok: false, reason: 'limit', limit: taken.limit, notInTier: !!taken.notInTier }, 429);
    let epreuve;
    try {
      epreuve = await runChain(env, {
      prompt: buildPrompt(type, classe, mois, resumes, notions, seed, texteType, niveau),
      max_tokens: type === 'lecture' ? 3400 : 3000,
      temperature: 0.85
      }, text => normalize(type, extractJson(text), classe));
    } catch (e) { await taken.release(); throw e; }
    return json({ ok: true, epreuve });
  } catch (err) {
    const msg = String((err && err.message) || '');
    console.error('generate-epreuve:', msg);
    // « quota » uniquement si le forfait quotidien est réellement épuisé ; saturation, 429, délai… = « busy » (réessayable).
    const reason = isDailyQuota(err) ? 'quota' : (/invalide/i.test(msg) ? 'invalid' : (/délai/i.test(msg) ? 'timeout' : 'busy'));
    return json({ ok: false, reason, error: msg }, 503);
  }
}
