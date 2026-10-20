import { json } from './_shared.js';

// Cloudflare Function — /api/generate-points
//
// Petit travail, IA très rapide : dans les « Activités de construction de nouveaux savoirs » (Mode Assisté, TOUTES
// les matières), le titre annonce ce que les élèves doivent découvrir (fait de langue, notion, texte, thème…).
// Cette fonction produit une question par ÉTAPE de la démarche de la matière (ex. « identifier le fait
// dans des phrases, le manipuler, dégager la règle »), avec le même objectif que l'étape, hors étape « règle » (déjà
// présente dans la démarche), jusqu'à 6 questions. Jamais de question pour les autres phases de la fiche.
//   requête  { matiere, classe, titre, seed, etapes, resume }
//   réponse  { ok:true, questions:["• Question ?", ...] }
// Modèles légers, essayés dans l'ordre (réglable : variable AI_FAST_MODELS, liste séparée par des virgules).
// Un échec n'est jamais bloquant : le front garde simplement le texte de la démarche tel quel.

// Modèles Workers AI les plus performants ET rapides pour ce travail (bon français, suivent un format imposé) :
//  1) Llama 4 Scout (17B actifs, architecture MoE : très rapide et nettement plus capable que les 3B/8B),
//  2) Llama 3.3 70B « fast » (le plus précis, un peu plus lent), 3) Llama 3.1 8B (secours très rapide).
// Le suivant démarre dès que le précédent échoue OU n'a pas répondu au bout de STALL_MS (sans l'interrompre) : la première
// réponse valide gagne. Réglable : variable AI_FAST_MODELS (liste séparée par des virgules), AI_STALL_MS.
const DEFAULT_FAST_MODELS = [
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-3.1-8b-instruct-fp8'
];
const FAST_TIMEOUT_MS = 20000;   // par modèle
const DEFAULT_STALL_MS = 6000;   // délai avant de lancer le modèle suivant en parallèle

function fastModels(env) {
  if (env.AI_FAST_MODELS) {
    const list = String(env.AI_FAST_MODELS).split(',').map(x => x.trim()).filter(Boolean);
    if (list.length) return list;
  }
  return DEFAULT_FAST_MODELS;
}

function aiText(result) {
  if (!result) return '';
  if (typeof result === 'string') return result;
  if (typeof result.response === 'string') return result.response;
  const c = result.choices && result.choices[0];
  if (c) return (c.message && c.message.content) || c.text || '';
  return '';
}

// Course entre les modèles. `accept(texte)` permet de refuser une réponse (ex. extrait de texte qui oublie une des formes
// étudiées) : on attend alors un autre modèle. Si aucune réponse n'est acceptée, on renvoie la dernière réponse non vide.
async function runFast(env, params, accept) {
  const models = fastModels(env);
  const stallMs = (env.AI_STALL_MS !== undefined && env.AI_STALL_MS !== '' && !isNaN(Number(env.AI_STALL_MS))) ? Math.max(0, Number(env.AI_STALL_MS)) : DEFAULT_STALL_MS;
  // Format « messages » : accepté par tous ces modèles de chat.
  const p = params.prompt ? { messages: [{ role: 'user', content: params.prompt }], max_tokens: params.max_tokens, temperature: params.temperature } : params;
  return new Promise((resolve, reject) => {
    let started = 0, ended = 0, done = false, lastErr = null, lastText = '', stallTimer = null;
    const finish = (fn, v) => { if (done) return; done = true; clearTimeout(stallTimer); fn(v); };
    const launchNext = () => {
      if (done || started >= models.length) return;
      const model = models[started++];
      clearTimeout(stallTimer);
      if (started < models.length) stallTimer = setTimeout(launchNext, stallMs);
      let t;
      Promise.race([
        Promise.resolve().then(() => env.AI.run(model, p)),
        new Promise((_, rej) => { t = setTimeout(() => rej(new Error('délai dépassé')), FAST_TIMEOUT_MS); })
      ]).then(result => {
        clearTimeout(t);
        const text = aiText(result);
        if (text.trim()) {
          lastText = text;
          if (!accept || accept(text)) { finish(resolve, text); return; }
        }
        throw new Error('réponse refusée');
      }).catch(err => {
        clearTimeout(t);
        lastErr = err; ended++;
        if (done) return;
        if (ended >= models.length) { lastText ? finish(resolve, lastText) : finish(reject, lastErr || new Error('IA indisponible')); return; }
        if (started < models.length) launchNext();   // échec : on passe au suivant tout de suite
      });
    };
    launchNext();
  });
}

const MAX_QUESTIONS = 7;        // total maximum pour la phase
const MAX_PER_TYPE = 3;         // au plus 3 questions pour le repérage (RELEVER), 3 pour la manipulation, etc.

// Formes étudiées quand le titre annonce des homophones (« Les homophones as – a – à » → as, a, à) : l'extrait de texte
// proposé doit les contenir TOUTES, sinon la réponse est refusée.
function formsFromTitle(titre) {
  const m = String(titre || '').match(/homophones?\s*(?:grammaticaux)?\s*[:\-–—]?\s*(.+)$/i);
  if (!m) return [];
  const rest = m[1];
  // Séparateurs explicites (as-a-à, et/est, on, ont) ; sinon, mots séparés par des espaces dont on retire « et » / « ou » de liaison.
  const parts = /[\-–—\/,;]/.test(rest) ? rest.split(/[\s\-–—\/,;]+/) : rest.split(/\s+/).filter(w => !/^(et|ou)$/i.test(w));
  const forms = parts.map(x => x.trim().toLowerCase()).filter(x => x && x.length <= 4);
  return Array.from(new Set(forms));
}
function extraitContains(extrait, forms) {
  if (!forms.length) return true;
  const words = String(extrait || '').toLowerCase().split(/[^a-zàâäéèêëîïôöùûüç]+/i).filter(Boolean);
  return forms.every(f => words.includes(f));
}

function buildPrompt(matiere, classe, titre, etapes, resume) {
  const hasEtapes = !!etapes;
  const consigne = hasEtapes
    ? `Travail demandé, en trois temps :
1) EXTRAIT DE TEXTE (seulement si la démarche demande de repérer / relever / identifier un fait de langue — orthographe, grammaire, conjugaison, vocabulaire — dans un texte ou des phrases) : invente un court extrait de texte (2 à 4 phrases simples, adaptées à la classe, écrites en français correct) dans lequel le fait étudié apparaît plusieurs fois. Si le titre annonce plusieurs formes (par exemple des homophones comme « as – a – à », « et – est », « on – ont », « son – sont », « ces – ses », « ce – se »), l'extrait doit contenir CHACUNE de ces formes, bien employées, au moins une fois. Écris-le sur UNE seule ligne : « TEXTE : « … » ». Pour les autres matières (lecture, communication orale, EST, mathématique…), n'écris pas de ligne TEXTE.
2) Découpe la démarche ci-dessus en ses ÉTAPES successives (dans l'ordre), en laissant de côté l'étape « dégager / formuler / rappeler la règle » (déjà prévue ailleurs) et les simples gestes du maître (écrire au tableau, transcrire, recopier…) qui ne demandent aucune réponse de l'élève. Garde au plus 6 étapes ; regroupe les étapes voisines si besoin. Donne à chaque étape un type : RELEVER (lire, observer, repérer, relever, identifier), COMPRENDRE (sens, idée générale, reformuler, résumer), MANIPULER (manipuler, transformer, comparer, classer, étudier, substituer) ou AUTRE.
3) Écris les questions adressées à l'élève. Le seul critère : que l'ensemble des questions conduise les élèves jusqu'à l'OBJECTIF FINAL de la leçon « ${titre} » en suivant le sens de la démarche. Il n'est PAS obligatoire de poser une question pour chaque étape : n'en écris que là où une question fait vraiment avancer les élèves, et pas plus de 3 questions pour une même étape (7 au total au maximum). Quand tu as écrit un extrait, les questions s'appuient sur CET extrait (« dans l'extrait », « dans la phrase… »).
   - Étape RELEVER d'un fait de langue : 1 à 3 questions qui amènent les élèves à repérer EUX-MÊMES le fait étudié dans l'extrait (ce qu'ils remarquent, ce qui se répète, ce qui se prononce pareil, ce qui change…), de sorte qu'ils le relèvent sans que le maître le leur désigne ; cette étape remplace la simple consigne « Relève le fait étudié ».
   - Étape MANIPULER quand le titre annonce plusieurs formes : une question PAR forme (jamais plusieurs formes dans la même question), qui fait manipuler cette forme-là (la remplacer par un mot de test, changer la personne, le temps, le nombre, la supprimer…) pour que l'élève découvre la particularité de cette forme et à quel moment il faut l'écrire. La question peut nommer le test à faire, mais jamais la conclusion. S'il y a plus de 3 formes, regroupe les manipulations les plus proches.
   - Autres étapes : 0, 1 ou 2 questions, seulement si elles servent l'objectif final.`
    : `Écris 2 questions : l'une pour observer ou repérer ce qu'annonce le titre, l'autre pour le faire expliquer ou manipuler.`;
  return `Tu aides un(e) enseignant(e) du primaire au Bénin à préparer la phase « Activités de construction de nouveaux savoirs ».

Matière : ${matiere || 'Français'}
Classe : ${classe || 'primaire'}
Titre de la séance : "${titre}"
${hasEtapes ? `Démarche officielle de cette phase (c'est la RÉFÉRENCE : tes questions doivent aller dans son sens et poursuivre le même objectif, étape par étape) : ${etapes}\n` : ''}${resume ? `Résumé de la leçon (c'est le CONTENU à enseigner : reste fidèle à lui, ne le contredis jamais) : ${resume}\n` : ''}
${consigne}

Comment faire correspondre la question à l'objectif de l'étape :
- étape « lire / écouter / observer / identifier / repérer / relever » → une question qui oblige l'élève à lire, observer ou repérer précisément ce que la leçon met en jeu ;
- étape « comprendre / préciser le sens / faire ressortir l'idée / résumer / reformuler » → une question qui fait dire le sens ou l'idée avec ses propres mots ;
- étape « manipuler / transformer / conjuguer / comparer / classer / étudier » → une question qui fait transformer, comparer ou classer des exemples tirés de la leçon ;
- étape « rechercher des idées / des mots / des raisons » → une question qui fait trouver des idées, des mots ou des raisons liés au titre ;
- étape « tracer / écrire / rédiger / corriger » → une question qui fait réaliser ou vérifier cette production précise.

Contraintes pour chaque question :
- une seule phrase courte, avec tutoiement, qui se termine par « ? » ;
- elle reprend le vocabulaire du titre et porte sur ce que les élèves ont sous les yeux (phrases, texte, image, situation ou matériel de la leçon) ;
- elle ne contient JAMAIS la réponse et ne parle pas de « démarche » ni d'« étape » ;
- elle ne doit pas être une question de rappel, de mise en situation, de pré-requis ni d'évaluation.

Exemple de FORME uniquement (autre titre, ne le recopie pas), pour « Les homophones et – est » avec la démarche « relever le fait orthographique dans le texte, le manipuler, dégager la règle » :
TEXTE : « Le chien est dans la cour et il aboie. Paul et Awa sont contents : la fête est belle. »
ÉTAPE 1 [RELEVER] : relever le fait orthographique dans le texte
QUESTION 1 : • Quels petits mots se prononcent « é » dans l'extrait ?
QUESTION 2 : • Lesquels se répètent le plus souvent ? Relève-les.
ÉTAPE 2 [MANIPULER] : manipuler chaque forme
QUESTION 3 : • Remplace « est » par « était » dans « la fête est belle » : la phrase garde-t-elle son sens ?
QUESTION 4 : • Essaie de remplacer « et » par « était » dans « Paul et Awa » : que constates-tu ?

Réponds UNIQUEMENT avec ce format : éventuellement la ligne « TEXTE : … », puis pour chaque étape une ligne « ÉTAPE n [TYPE] : … » suivie d'une ou plusieurs lignes « QUESTION n : • … ? », sans aucun autre texte.`;
}

function parsePoints(raw) {
  const lines = String(raw || '').split('\n');
  let extrait = '';
  const points = [];
  let type = 'AUTRE';
  const hasQ = lines.some(l => /^\s*QUESTION\s*\d*\s*[:：]/i.test(l));
  lines.forEach(line => {
    const tm = line.match(/^\s*TEXTE\s*[:：]\s*(.+)$/i);
    if (tm) { extrait = tm[1].trim().replace(/^[«"“]\s*/, '').replace(/\s*[»"”]$/, '').trim(); return; }
    const em = line.match(/^\s*[ÉE]TAPE\s*\d*\s*(?:\[\s*([A-ZÉ]+)\s*\])?\s*[:：]/i);
    if (em) { const t = (em[1] || '').toUpperCase(); type = ['RELEVER','COMPRENDRE','MANIPULER'].includes(t) ? t : 'AUTRE'; return; }
    if (hasQ && !/^\s*QUESTION\s*\d*\s*[:：]/i.test(line)) return;
    let t = line.trim().replace(/^QUESTION\s*\d*\s*[:：]\s*/i, '').replace(/^[•\-–*\d.)\s]+/, '').trim();
    if (!t || t.length < 12 || t.length > 300) return;
    if (t.includes('?')) t = t.slice(0, t.lastIndexOf('?') + 1);
    else if (!hasQ) return;   // sans ligne « QUESTION n : » (format non respecté), on ne garde que les vraies questions
    // Question sur la règle : déjà couverte par la ligne « Dégage la règle » de la démarche.
    if (/\b(r[èe]gle)\b/i.test(t)) return;
    if (!points.some(x => x.q.toLowerCase() === ('• ' + t).toLowerCase())) points.push({ type, q: '• ' + t });
  });
  // Plafonds : 3 questions par type d'étape, 7 au total.
  const perType = {};
  const kept = points.filter(x => (perType[x.type] = (perType[x.type] || 0) + 1) <= MAX_PER_TYPE).slice(0, MAX_QUESTIONS);
  return { extrait: extrait.length >= 15 && extrait.length <= 600 ? extrait : '', points: kept };
}

/* ---------- Mode « ligne par ligne » (demande du 20/10/2026) ----------
   Le front envoie les lignes de la démarche de la phase (celles qui demandent une activité de l'élève) ; pour CHAQUE ligne,
   on propose 1 à 3 activités (1 suffit souvent, 3 au maximum), dans le sens et avec le même objectif que la ligne, appliquées à la
   leçon et, pour les faits de langue, à un court extrait de texte inventé. L'ensemble doit conduire à l'objectif final. */
const MAX_LINES = 16;
const MAX_ACTS_PER_LINE = 3;

function buildLinesPrompt(matiere, classe, titre, lignes, resume) {
  const liste = lignes.map(l => `${l.i}. ${l.text}`).join('\n');
  return `Tu aides un(e) enseignant(e) du primaire au Bénin à préparer la phase « Activités de construction de nouveaux savoirs ».

Matière : ${matiere || 'Français'}
Classe : ${classe || 'primaire'}
Titre de la séance : "${titre}"
${resume ? `Résumé de la leçon (c'est le CONTENU à enseigner : reste fidèle à lui, ne le contredis jamais) : ${resume}\n` : ''}
Voici les lignes de la démarche officielle de cette phase, dans l'ordre (c'est la RÉFÉRENCE) :
${liste}

Travail demandé :
1) EXTRAIT DE TEXTE (seulement si la démarche demande de repérer / relever / identifier un fait de langue — orthographe, grammaire, conjugaison, vocabulaire — dans un texte ou des phrases) : invente un court extrait (2 à 4 phrases simples, adaptées à la classe, en français correct) où le fait étudié apparaît plusieurs fois. Si le titre annonce plusieurs formes (homophones comme « as – a – à », « et – est », « on – ont », « son – sont », « ces – ses », « ce – se »…), l'extrait contient CHACUNE de ces formes, bien employées, au moins une fois. Écris-le sur UNE seule ligne : « TEXTE : « … » ». Pour les autres matières, n'écris pas de ligne TEXTE.
2) Pour CHAQUE ligne numérotée ci-dessus, propose de 1 à ${MAX_ACTS_PER_LINE} activités pour l'élève (consigne ou question, au tutoiement, une seule phrase courte chacune) qui lui font réaliser ce que dit la ligne, avec le MÊME objectif pédagogique. Une seule activité suffit souvent : n'en écris plusieurs que si elles aident vraiment les élèves à y arriver, jamais plus de ${MAX_ACTS_PER_LINE} pour une ligne, et ne répète jamais la même activité.
   - Ligne qui demande de relever / repérer / identifier un fait : les activités amènent les élèves à le repérer EUX-MÊMES dans l'extrait (ce qu'ils remarquent, ce qui se répète, ce qui se prononce pareil…) sans que le maître le leur désigne.
   - Ligne qui demande de manipuler / étudier un fait annoncé en PLUSIEURS formes par le titre : une activité PAR forme (jamais deux formes dans la même activité) qui la fait manipuler (la remplacer par un mot de test, changer la personne, le temps, le nombre…) pour découvrir sa particularité et quand l'écrire ; tu peux nommer le test à faire, jamais la conclusion. Si cela dépasse ${MAX_ACTS_PER_LINE}, regroupe les formes les plus proches.
   - Autres lignes : garde le sens de la ligne et adapte-la à la leçon « ${titre} » (avec des mots, phrases ou exemples tirés de la leçon ou de l'extrait quand c'est utile).
3) L'ensemble des activités doit conduire les élèves à l'OBJECTIF FINAL de la leçon. N'écris jamais la réponse, ni les mots « démarche » ou « étape ».

Exemple de FORME uniquement (autre leçon, ne le recopie pas), pour « Les homophones et – est » :
TEXTE : « Le chien est dans la cour et il aboie. Paul et Awa sont contents : la fête est belle. »
LIGNE 1 : • Lis à haute voix l'extrait écrit au tableau.
LIGNE 2 : • Quels petits mots se prononcent « é » dans l'extrait ?
LIGNE 2 : • Lesquels se répètent ? Relève-les.
LIGNE 3 : • Remplace « est » par « était » dans « la fête est belle » : la phrase garde-t-elle son sens ?
LIGNE 3 : • Essaie de remplacer « et » par « était » dans « Paul et Awa » : que constates-tu ?

Réponds UNIQUEMENT avec ce format : éventuellement la ligne « TEXTE : … », puis pour chaque ligne numérotée une ou plusieurs lignes « LIGNE n : • … » (n = le numéro donné ci-dessus), sans aucun autre texte.`;
}

function parseLines(raw, validNums) {
  let extrait = '';
  const acts = {};
  String(raw || '').split('\n').forEach(line => {
    const tm = line.match(/^\s*TEXTE\s*[:：]\s*(.+)$/i);
    if (tm) { extrait = tm[1].trim().replace(/^[«"“]\s*/, '').replace(/\s*[»"”]$/, '').trim(); return; }
    const lm = line.match(/^\s*LIGNE\s*(\d+)\s*[:：]\s*(.+)$/i);
    if (!lm) return;
    const n = Number(lm[1]);
    if (!validNums.includes(n)) return;
    let t = lm[2].trim().replace(/^[•\-–*\s]+/, '').trim();
    if (t.length < 8 || t.length > 320) return;
    const list = (acts[n] = acts[n] || []);
    if (list.length < MAX_ACTS_PER_LINE && !list.some(x => x.toLowerCase() === ('• ' + t).toLowerCase())) list.push('• ' + t);
  });
  return { extrait: extrait.length >= 15 && extrait.length <= 600 ? extrait : '', acts };
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    if (!env.AI) return json({ ok: false, reason: 'ai-unavailable' }, 501);
    const body = await request.json();
    const titre = String(body.titre || '').trim().slice(0, 300);
    const matiere = String(body.matiere || '').trim().slice(0, 80);
    const classe = String(body.classe || '').trim().slice(0, 40);
    const etapes = String(body.etapes || '').trim().slice(0, 1500);
    const resume = String(body.resume || '').trim().slice(0, 1200);
    if (!titre) return json({ ok: false, reason: 'invalid-params' }, 400);
    const forms = formsFromTitle(titre);

    // Mode ligne par ligne : 1 à 3 activités par ligne de la démarche.
    const lignes = Array.isArray(body.lignes)
      ? body.lignes.slice(0, MAX_LINES).map(l => ({ i: Number(l && l.i), text: String((l && l.text) || '').trim().slice(0, 400) })).filter(l => Number.isInteger(l.i) && l.text)
      : [];
    if (lignes.length) {
      const nums = lignes.map(l => l.i);
      const rawL = await runFast(env, {
        prompt: buildLinesPrompt(matiere, classe, titre, lignes, resume),
        max_tokens: 2000,
        temperature: 0.5
      }, text => { const r = parseLines(text, nums); return Object.keys(r.acts).length >= Math.ceil(nums.length / 2) && (!forms.length || (r.extrait && extraitContains(r.extrait, forms))); });
      let { extrait: exL, acts } = parseLines(rawL, nums);
      if (exL && !extraitContains(exL, forms)) exL = '';
      if (!Object.keys(acts).length) return json({ ok: false, reason: 'ai-empty' }, 502);
      return json({ ok: true, mode: 'lignes', extrait: exL, lignes: nums.filter(n => acts[n]).map(n => ({ i: n, activites: acts[n] })) });
    }
    const raw = await runFast(env, {
      prompt: buildPrompt(matiere, classe, titre, etapes, resume),
      max_tokens: 1000,
      temperature: 0.5
    }, text => { const r = parsePoints(text); return r.points.length > 0 && (!forms.length || (r.extrait && extraitContains(r.extrait, forms))); });
    let { extrait, points } = parsePoints(raw);
    if (extrait && !extraitContains(extrait, forms)) extrait = '';   // extrait qui oublie une forme étudiée : on ne l'affiche pas
    if (!points.length) return json({ ok: false, reason: 'ai-empty' }, 502);
    return json({ ok: true, questions: points.map(x => x.q), points, extrait });
  } catch (err) {
    return json({ ok: false, reason: 'ai-busy', error: err.message }, 503);
  }
}
