import { json } from './_shared.js';

// Cloudflare Function — /api/generate-assiste
//
// Branché sur le "Mode Assisté" défini côté client dans index.html (voir le
// bloc "MODE ASSISTÉ — GÉNÉRATION PAR IA (Cloudflare Workers AI)", décision
// du 03/10/2026) : l'enseignant saisit juste le titre de la séance, et
// certains champs pédagogiques (Mise en situation, Pré-requis,
// Pré-conception, et pour certaines matières sans banque de variantes comme
// Écriture, tous les champs non fixes) sont rédigés par l'IA à partir de la
// démarche propre à la matière.
//
// Contrat (déjà fixé côté front par fetchAssistedAiFields) :
//   requête  { matiere, classe, titre, demarche, items: [{label, consigne}] }
//   réponse  { ok:true, items: { [label]: "texte généré" } }
// Le front n'utilise que les clés de "items" qui correspondent à un label
// qu'il a demandé ; un label absent de la réponse reste simplement tel quel
// dans le formulaire (pas d'erreur bloquante).

const MAX_ITEMS = 15; // garde-fou : une fiche + son en-tête ne dépassent jamais ça
const MAX_RESUME_CHARS = 4000; // garde-fou : le résumé est transmis tel quel dans le prompt

// Le modèle écrit parfois de vrais retours à la ligne à l'intérieur des chaînes
// JSON (invalide) : on les remplace par \n, uniquement à l'intérieur des chaînes.
function escapeNewlinesInStrings(text) {
  let out = '';
  let inString = false;
  let escaped = false;
  for (const ch of text) {
    if (inString) {
      if (escaped) { out += ch; escaped = false; continue; }
      if (ch === '\\') { out += ch; escaped = true; continue; }
      if (ch === '"') { out += ch; inString = false; continue; }
      if (ch === '\n') { out += '\\n'; continue; }
      if (ch === '\r') { continue; }
      out += ch;
    } else {
      if (ch === '"') inString = true;
      out += ch;
    }
  }
  return out;
}

function extractJson(raw) {
  const cleaned = (raw || '').trim().replace(/^```json\s*|^```\s*|```$/g, '');
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  const slice = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(slice);
  } catch {
    try {
      return JSON.parse(escapeNewlinesInStrings(slice));
    } catch {
      return null;
    }
  }
}

// Clé comparable : sans accents, minuscules, sans ponctuation (le modèle écrit parfois
// « Mise en situation » sous une autre graphie : « Mise en situation : », « mise en situation »…).
function normKey(k) {
  return String(k || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// Réponse coupée par la limite de longueur (JSON jamais refermé) : on récupère quand même les
// paires "clé":"valeur" déjà complètes, au lieu de perdre tout le lot.
function salvagePairs(raw) {
  const out = {};
  const re = /"((?:[^"\\]|\\.)+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
  let m;
  while ((m = re.exec(raw || '')) !== null) {
    try { out[JSON.parse('"' + m[1] + '"')] = JSON.parse('"' + m[2].replace(/\n/g, '\\n') + '"'); } catch { /* paire illisible : ignorée */ }
  }
  return out;
}

// Le modèle renvoie parfois un tableau ou un objet imbriqué (ex. {"texte":"…","questions":["…"]}) au lieu d'une
// simple chaîne : on aplatit tout en texte (une ligne par élément) plutôt que de perdre le champ.
function toText(v) {
  if (typeof v === 'string') return v.trim();
  if (Array.isArray(v)) return v.map(toText).filter(Boolean).join('\n');
  if (v && typeof v === 'object') return Object.values(v).map(toText).filter(Boolean).join('\n');
  return '';
}

// Chaîne de modèles Workers AI : si le premier échoue (modèle saturé, quota par minute, erreur interne),
// on passe automatiquement au suivant, sans que l'enseignant le voie. Le premier modèle est rapide et
// économique ; les suivants sont plus puissants (meilleur français, consignes plus riches).
// Réglable sans toucher au code : variable AI_MODELS (liste séparée par des virgules) ou AI_MODEL (1er modèle).
const DEFAULT_MODELS = [
  '@cf/meta/llama-3.1-8b-instruct-fp8',
  '@cf/mistralai/mistral-small-3.1-24b-instruct',
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast'
];
function modelChain(env) {
  if (env.AI_MODELS) {
    const list = String(env.AI_MODELS).split(',').map(x => x.trim()).filter(Boolean);
    if (list.length) return list;
  }
  return env.AI_MODEL ? [env.AI_MODEL].concat(DEFAULT_MODELS.slice(1)) : DEFAULT_MODELS;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Les modèles ne répondent pas tous dans le même format : { response } ou format « chat » { choices:[…] }.
function aiText(result) {
  if (!result) return '';
  if (typeof result === 'string') return result;
  if (typeof result.response === 'string') return result.response;
  const c = result.choices && result.choices[0];
  if (c) return (c.message && c.message.content) || c.text || '';
  return '';
}

// Course entre les modèles, sans temps mort : le 1er modèle part tout de suite ; le suivant part
// (a) immédiatement si le précédent échoue (erreur, saturation, réponse vide), sans pause ni 2e essai
// sur le même modèle, ou (b) si le précédent n'a pas répondu au bout de AI_STALL_MS (8 s par défaut),
// SANS l'interrompre. La première réponse valide l'emporte. AI_STALL_MS=0 : tous partent ensemble.
async function runAi(env, _unusedModel, params) {
  const models = modelChain(env);
  const stallRaw = env.AI_STALL_MS;
  const stallMs = (stallRaw !== undefined && stallRaw !== '' && !isNaN(Number(stallRaw))) ? Math.max(0, Number(stallRaw)) : 8000;
  return new Promise((resolve, reject) => {
    let started = 0, failed = 0, done = false, lastErr = null, timer = null;
    const finish = (fn, val) => { if (done) return; done = true; clearTimeout(timer); fn(val); };
    const launchNext = () => {
      if (done || started >= models.length) return;
      const model = models[started++];
      clearTimeout(timer);
      if (started < models.length) timer = setTimeout(launchNext, stallMs);
      Promise.resolve()
        .then(() => env.AI.run(model, params))
        .then(result => {
          const text = aiText(result);
          if (!text.trim()) throw new Error('réponse vide');
          finish(resolve, { response: text, model });
        })
        .catch(err => {
          lastErr = err;
          failed++;
          if (done) return;
          if (failed >= models.length) { finish(reject, lastErr || new Error('IA indisponible')); return; }
          if (started < models.length) launchNext(); // échec : on passe au suivant tout de suite
        });
    };
    launchNext();
  });
}

/* ---------- Unicité des fiches ----------
   Mille enseignants peuvent écrire une fiche avec le même titre : chaque fiche reçoit un « fil conducteur »
   différent (décor, prénoms, forme de la mise en situation) tiré au hasard à partir d'une graine propre à la fiche
   (envoyée par l'application). La graine est stable pour une même fiche (un « Réessayer » garde le même fil
   conducteur) et différente d'une fiche à l'autre. Le décor n'est qu'un habillage : la situation doit toujours
   conduire directement à la notion du titre. */
const DECORS = [
  "le marché du village", "la cour de l'école pendant la récréation", "le champ de la famille", "une partie de pêche au bord du fleuve",
  "la cuisine de la maison", "un match de football du quartier", "la fête de fin d'année à l'école", "l'atelier du menuisier",
  "le jardin scolaire", "la rentrée des classes", "un voyage en car vers la ville", "la boutique du quartier", "la ferme et ses animaux",
  "la forêt après la pluie", "le puits du village", "une cérémonie en famille", "la bibliothèque de l'école", "l'atelier de la couturière",
  "le potager de grand-mère", "le marché aux poissons", "le chemin de l'école le matin", "une journée de nettoyage du quartier",
  "la cantine de l'école", "un anniversaire", "la boulangerie du coin", "la préparation d'un repas de fête", "le tournoi de jeux de l'école",
  "la visite d'un artisan à l'école", "un après-midi de jeux dans la cour", "la cour de la maison un dimanche", "la réunion des parents d'élèves",
  "la cueillette de fruits", "la construction d'un poulailler", "la sortie pédagogique de la classe", "la pharmacie du village", "la rivière en saison des pluies"
];
const SITUATION_TYPES = [
  "une petite histoire racontée par le maître", "un problème de la vie courante posé aux élèves", "un court dialogue entre deux élèves",
  "l'observation d'un objet ou d'une image apportée en classe", "un jeu collectif", "une devinette ou une énigme", "un défi lancé à la classe",
  "une courte scène jouée par des élèves", "une petite enquête rapide dans la classe", "le souvenir d'un événement vécu par les élèves",
  "une question étonnante posée par le maître", "une situation où il manque quelque chose et où il faut trouver comment faire"
];
const PRENOMS = [
  "Koffi", "Afi", "Sènami", "Comlan", "Fifamè", "Dossou", "Aïcha", "Mariama", "Codjo", "Adjoa", "Ismaël", "Roukayath", "Gbèdji", "Honorine",
  "Prisca", "Séraphin", "Nadège", "Ayaba", "Kokou", "Estelle", "Armand", "Zouera", "Yannick", "Mawulé", "Chimène", "Basile", "Fatoumata",
  "Dieudonné", "Reine", "Habib", "Judith", "Samuel", "Rachidatou", "Gildas", "Sabine", "Moussa"
];
function hashSeed(str) {            // xfnv1a
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pickVariation(seed) {
  const base = String(seed || '').trim() || (Math.random().toString(36) + Date.now().toString(36));
  const rnd = mulberry32(hashSeed(base));
  const pick = arr => arr[Math.floor(rnd() * arr.length)];
  const a = pick(PRENOMS);
  let b = pick(PRENOMS);
  for (let k = 0; k < 6 && b === a; k++) b = pick(PRENOMS);
  return { decor: pick(DECORS), type: pick(SITUATION_TYPES), noms: [a, b] };
}
function buildVariationBloc(titre, seed, hasMiseEnSituation) {
  const v = pickVariation(seed);
  return `Fil conducteur propre à CETTE fiche (pour que deux fiches sur le même titre ne se ressemblent jamais) :
- Décor : ${v.decor}
- Prénoms d'élèves à utiliser dans les exemples : ${v.noms[0]} et ${v.noms[1]}
- Forme de la mise en situation : ${v.type}
Règles : le décor n'est qu'un habillage ; tout ce que tu rédiges doit rester centré sur la notion du titre « ${titre} » et y conduire directement, au niveau de la classe. Si le décor ne convient vraiment pas à ce titre, prends le décor le plus proche qui convient. Invente des exemples neufs et originaux : évite les exemples les plus courants et banals de ce sujet.
${hasMiseEnSituation ? "Pour « Mise en situation » : 3 à 5 phrases, selon la forme imposée, avec le décor et les prénoms ci-dessus ; la situation doit amener naturellement les élèves vers la notion du titre (sans la donner d'emblée) et se terminer par UNE ou DEUX questions (jamais plus de deux) posées directement aux élèves, qui les amènent vers la notion sans la nommer : l'annonce de la leçon vient après, dans la proposition de nouvelles acquisitions.\n" : ''}
`;
}

// Demande au modèle les champs `items` et renvoie { label: texte } pour ceux effectivement rédigés.
async function generateOnce(env, matiere, classe, titre, demarche, items, resume, seed) {
  const prompt = buildPrompt(matiere, classe, titre, demarche, items, resume, seed);
  const result = await runAi(env, null, {
    prompt,
    max_tokens: 4096,
    temperature: 0.8
  });
  const raw = (result && (result.response || '')).trim();
  const parsed = extractJson(raw);
  let generated = parsed && parsed.items && typeof parsed.items === 'object' ? parsed.items : null;
  if (!generated) {
    const salvaged = salvagePairs(raw);
    generated = Object.keys(salvaged).length ? (salvaged.items && typeof salvaged.items === 'object' ? salvaged.items : salvaged) : null;
  }
  if (!generated) return null;

  const byNorm = {};
  Object.keys(generated).forEach(k => { byNorm[normKey(k)] = generated[k]; });
  const out = {};
  items.forEach(it => {
    let v = generated[it.label];
    if (v === undefined) v = byNorm[normKey(it.label)];
    const text = toText(v);
    if (text) out[it.label] = text;
  });
  return out;
}

/* ---------- Mode « texte brut » : un seul champ long à développer ----------
   Les champs d'activités sont longs : les demander dans un objet JSON fait échouer ou tronquer la réponse
   (le champ retombe alors sur le texte de base de la démarche). Ici le modèle répond directement par le
   texte du champ, un champ par requête, et on relance une fois si la réponse reste trop proche du texte de base. */
function buildResumeBloc(resume) {
  return resume
    ? `Résumé de la leçon (c'est le CONTENU à enseigner : les activités, questions, exemples et réponses attendues doivent s'appuyer sur lui et ne jamais le contredire) :
"""
${resume}
"""

`
    : `Aucun résumé de leçon n'est fourni : appuie-toi sur le titre et sur la démarche, sans inventer de faits précis que tu ne peux pas vérifier.

`;
}

// Illustration : le modèle propose UNE image seulement quand elle aide vraiment l'élève ; la ligne est retirée du texte.
const IMAGE_INSTRUCTION = `- ILLUSTRATION (facultative) : si, et seulement si, une image simple aide vraiment les élèves à comprendre cette étape (un objet, un animal, une plante, une scène du quotidien, une figure géométrique, des objets à compter, un schéma simple), ajoute tout à la fin UNE dernière ligne exactement de la forme [IMAGE: description courte EN ANGLAIS d'une illustration simple, sans aucun texte, lettre ni chiffre]. Si l'étape ne demande pas d'image (consignes orales, calcul, lecture, conjugaison, règle…), n'ajoute RIEN.
`;
/* Champ ordinaire : la démarche de la matière fait foi. L'IA ne fait que reformuler légèrement ses consignes
   (synonymes, tournures) : mêmes consignes, même ordre, même sens, rien d'ajouté. */
function buildRephrasePrompt(matiere, classe, titre, item, strict) {
  return `Tu aides un(e) enseignant(e) du primaire au Bénin à rédiger une fiche pédagogique.

Matière : ${matiere}
Classe : ${classe || '(non précisée)'}
Titre de la séance : "${titre}"

Champ : "${item.label}"
Texte de la démarche pour ce champ (c'est la référence : il est déjà correct) :
"""
${item.base}
"""

Ta tâche : REFORMULER LÉGÈREMENT ce texte, pour que deux enseignants n'aient pas exactement les mêmes phrases.
Règles strictes :
- Garde exactement les mêmes consignes, dans le même ordre, avec le même sens et le même nombre de lignes.
- Change seulement quelques mots (synonymes, verbes de consigne) et quelques tournures de phrase.
- N'ajoute AUCUNE consigne, AUCUN exemple, AUCUNE explication, AUCUNE réponse attendue ; ne supprime rien.
- Garde la même forme (puces « • », sauts de ligne, sous-lignes éventuelles), le tutoiement et une longueur proche de l'original.
- Conserve tels quels le titre de la séance, les mots entre guillemets, les noms propres, les termes techniques et les nombres.
${strict ? "- ATTENTION : ta première réponse s'éloignait trop du texte de la démarche. Reste très proche de l'original : change seulement un mot ou une tournure par ligne.\n" : ''}
Réponds UNIQUEMENT avec le texte reformulé : pas de titre, pas de JSON, pas de commentaire.`;
}

function buildPlainPrompt(matiere, classe, titre, demarche, item, resume, escalate, seed) {
  return `Tu aides un(e) enseignant(e) du primaire au Bénin à rédiger une fiche pédagogique.

Matière : ${matiere}
Classe : ${classe || '(non précisée)'}
Titre de la séance : "${titre}"

Démarche pédagogique de la matière (suis-la : même sens, même ordre des étapes) :
${demarche}

${buildResumeBloc(resume)}${buildVariationBloc(titre, seed, /mise en situation/i.test(item.label))}Champ à rédiger : "${item.label}"
Consigne pour ce champ :
${item.consigne}

Exigences :
- Écris en français, au tutoiement, pour des élèves de ${classe || 'primaire'}.
- Reste dans le sens exact de la démarche : mêmes étapes, même ordre, rien d'étranger à la démarche.
- Utilise des SYNONYMES et des tournures originales (verbes de consigne variés, formulations personnelles) : cette fiche ne doit pas ressembler à celles des autres enseignants qui suivent la même démarche.
- Reste BREF et PRÉCIS : 4 à 6 consignes au total (7 au maximum), une seule phrase courte par consigne, avec seulement les mots, phrases ou exemples tirés de la leçon et du résumé qui sont utiles ; la réponse attendue entre parenthèses seulement quand elle est très courte.
- Une consigne par ligne, chacune commençant par « • ».
- Exemple de FORME uniquement (autre leçon, ne le recopie pas) :
  Texte de base : « • Lis les phrases du tableau.\\n• Dis ce que tu remarques. »
  Texte développé : « • Lis à haute voix les phrases écrites au tableau : « Le chat dort. » ; « Les enfants jouent. »\\n• Dis ce que ces phrases ont en commun (elles commencent par une majuscule et se terminent par un point).\\n• Souligne dans chaque phrase le mot qui dit qui fait l'action (le chat ; les enfants). »
${escalate ? "- ATTENTION : ta première réponse était trop proche du texte de base. Développe un peu plus (exemples concrets tirés de la leçon), mais reste à 7 consignes au maximum, chacune courte.\n" : ''}${IMAGE_INSTRUCTION}
Réponds UNIQUEMENT avec le texte final du champ (suivi, au besoin, de la ligne [IMAGE: …]) : pas de titre, pas de JSON, pas de commentaire.`;
}

function cleanPlain(raw, label) {
  let t = String(raw || '').trim().replace(/^```[a-z]*\s*/i, '').replace(/```$/, '').trim();
  if (t.startsWith('{')) { // le modèle a quand même répondu en JSON : on récupère la valeur
    const p = extractJson(t);
    if (p) {
      const v = p.items && typeof p.items === 'object' ? Object.values(p.items)[0] : Object.values(p)[0];
      t = toText(v);
    }
  }
  const lines = t.split('\n');
  if (lines.length && normKey(lines[0].replace(/[:：]\s*$/, '')) === normKey(label)) lines.shift(); // libellé répété
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Sépare la ligne [IMAGE: …] du texte du champ.
function splitImage(raw) {
  const t = String(raw || '');
  const m = t.match(/\[\s*IMAGE\s*:\s*([^\]]{6,300})\]/i);
  const image = m ? m[1].replace(/\s+/g, ' ').trim() : '';
  const text = t.replace(/\[\s*IMAGE\s*:[^\]]*\]?/gi, '').replace(/\n{3,}/g, '\n\n').trim();
  return { text, image };
}

// Reformulation légère : on vérifie que le texte reste proche de la démarche (longueur et nombre de lignes) ;
// sinon deuxième essai plus strict, puis on garde le texte de la démarche tel quel (jamais de dérive).
function lineCount(s) { return String(s || '').split('\n').map(x => x.trim()).filter(Boolean).length; }
function closeToBase(text, base) {
  if (!text || !base) return false;
  const ratio = text.length / base.length;
  if (ratio < 0.6 || ratio > 1.45) return false;
  return Math.abs(lineCount(text) - lineCount(base)) <= 1;
}
async function generateRephrase(env, matiere, classe, titre, item) {
  const base = String(item.base || '').trim();
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await runAi(env, null, {
      prompt: buildRephrasePrompt(matiere, classe, titre, item, attempt > 0),
      max_tokens: 1500,
      temperature: attempt === 0 ? 0.6 : 0.35
    });
    const text = cleanPlain(splitImage((result && result.response) || '').text, item.label);
    if (closeToBase(text, base)) return { text, image: '' };
  }
  return { text: base, image: '' };
}

async function generatePlain(env, matiere, classe, titre, demarche, item, resume, seed) {
  if (item.mode === 'rephrase' && item.base) return generateRephrase(env, matiere, classe, titre, item);
  let image = '';
  const run = async (escalate) => {
    const result = await runAi(env, null, {
      prompt: buildPlainPrompt(matiere, classe, titre, demarche, item, resume, escalate, seed),
      max_tokens: 2800,
      temperature: escalate ? 0.85 : 0.72
    });
    const parts = splitImage((result && result.response) || '');
    if (parts.image && !image) image = parts.image;
    return cleanPlain(parts.text, item.label);
  };
  let text = await run(false);
  const minLen = Number(item.minLen) || 0;
  if (!text || (minLen && text.length < minLen)) {
    const second = await run(true);
    if (second && second.length > (text || '').length) text = second;
  }
  return { text, image };
}

function buildPrompt(matiere, classe, titre, demarche, items, resume, seed) {
  const champsListe = items
    .map((it, i) => `${i + 1}. "${it.label}" — ${it.consigne}`)
    .join('\n');

  const resumeBloc = resume
    ? `Résumé de la leçon (c'est le CONTENU à enseigner : les activités, questions, exemples et réponses attendues doivent s'appuyer sur lui et ne jamais le contredire) :
"""
${resume}
"""

`
    : `Aucun résumé de leçon n'est fourni : appuie-toi sur le titre et sur la démarche, sans inventer de faits précis que tu ne peux pas vérifier.

`;

  return `Tu aides un(e) enseignant(e) du primaire au Bénin à rédiger une fiche pédagogique.

Matière : ${matiere}
Classe : ${classe || '(non précisée)'}
Titre de la séance : "${titre}"

Démarche pédagogique propre à cette matière (étapes de la séance : tout ce que tu rédiges doit suivre cette démarche, dans le même sens et le même ordre) :
${demarche}

${resumeBloc}${buildVariationBloc(titre, seed, items.some(it => /mise en situation/i.test(it.label)))}Rédige le contenu des champs suivants, en français, adapté à des élèves de ${classe || 'primaire'}, en lien direct avec le titre de la séance et avec le résumé de la leçon. Chaque champ a sa propre consigne précise à respecter, y compris pour sa longueur : court pour une question ou une mise en situation, DÉTAILLÉ (plusieurs consignes, avec questions, exemples tirés de la leçon et réponses attendues) pour les activités, l'objectivation, l'évaluation et les autres étapes de la démarche :
${champsListe}

Réponds UNIQUEMENT avec un objet JSON strict, sans aucun texte autour, sans balises markdown, au format exact :
{"items":{${items.map(it => `"${it.label}":"..."`).join(',')}}}

Chaque valeur doit être le texte rédigé pour ce champ : une chaîne (pas un objet ni un tableau) ; quand un champ comporte plusieurs lignes, sépare-les par \\n à l'intérieur de la chaîne. Deux enseignants qui utilisent la même démarche ne doivent pas obtenir des formulations identiques : varie le vocabulaire et les tournures, tout en respectant la consigne de chaque champ.`;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    if (!env.AI) {
      return json({ error: "Le mode assisté n'est pas configuré sur ce déploiement (binding AI manquant)." }, 501);
    }

    const body = await request.json();
    const matiere = String(body.matiere || '').trim();
    const classe = String(body.classe || '').trim();
    const titre = String(body.titre || '').trim();
    const demarche = String(body.demarche || '').trim();
    const items = Array.isArray(body.items) ? body.items.slice(0, MAX_ITEMS) : [];
    // Résumé de la leçon (facultatif) : contenu réel sur lequel s'appuient les activités.
    const resume = String(body.resume || '').trim().slice(0, MAX_RESUME_CHARS);
    // Graine propre à la fiche (voir pickVariation) : garantit des fiches différentes pour un même titre.
    const seed = String(body.seed || '').slice(0, 64);

    if (!titre || !demarche || !items.length) {
      return json({ ok: false, reason: 'invalid-params' }, 400);
    }

    // Champ long à développer : réponse en texte brut, un champ par requête.
    if (body.plain === true && items.length === 1) {
      const { text, image } = await generatePlain(env, matiere, classe, titre, demarche, items[0], resume, seed);
      if (!text) return json({ ok: false, reason: 'ai-empty' }, 502);
      return json({ ok: true, items: { [items[0].label]: text }, imagePrompts: image ? { [items[0].label]: image } : {} });
    }

    let outItems = await generateOnce(env, matiere, classe, titre, demarche, items, resume, seed);

    // Champs demandés absents de la réponse (ex. « Mise en situation » oubliée par le modèle) :
    // une seule relance ciblée sur ces champs.
    const missing = items.filter(it => !outItems || !outItems[it.label]);
    if (missing.length) {
      const retry = await generateOnce(env, matiere, classe, titre, demarche, missing, resume, seed);
      if (retry) outItems = Object.assign(outItems || {}, retry);
    }

    if (!outItems || !Object.keys(outItems).length) {
      return json({ ok: false, reason: 'ai-no-json' }, 502);
    }

    return json({ ok: true, items: outItems });
  } catch (err) {
    return json({ error: "Erreur lors de la génération assistée : " + err.message, reason: 'ai-busy' }, 503);
  }
}
