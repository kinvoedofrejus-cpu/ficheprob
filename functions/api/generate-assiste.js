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
  '@cf/meta/llama-4-scout-17b-16e-instruct',      // rapide (MoE, 17B actifs) et bien plus capable que le 8B
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',     // le plus précis
  '@cf/meta/llama-3.1-8b-instruct-fp8'            // secours très rapide
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
        .then(() => env.AI.run(model, params.prompt ? { messages: [{ role: 'user', content: params.prompt }], max_tokens: params.max_tokens, temperature: params.temperature } : params))
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
${hasMiseEnSituation ? "Pour « Mise en situation » : 3 à 5 phrases, selon la forme imposée, avec le décor et les prénoms ci-dessus. Elle doit CADRER avec le texte ou le résumé de la leçon fourni plus haut (mêmes notions, mêmes mots-clés, aucune contradiction) sans en dévoiler le contenu, et amener naturellement les élèves vers la notion du titre (sans la donner d'emblée). Elle se termine par UNE ou DEUX questions (jamais plus de deux), posées directement aux élèves, qui piquent leur curiosité et leur donnent ENVIE de faire la leçon, sans nommer la notion : l'annonce de la leçon vient après, dans la proposition de nouvelles acquisitions.\n" : ''}
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

/* ---------- EPS (CE1-CM2) : développement guidé par les fiches modèles de l'enseignant ----------
   Demande du 25/10/2026 : en Mode Assisté, l'EPS ne doit plus se contenter de coller (ou de reformuler) les textes de la
   démarche : l'IA les DÉVELOPPE, en concrétisant chaque étape pour l'activité du titre (gestes, terrain ou atelier,
   matériel, mesures de sécurité, règles, stratégies, organisation). Les fiches modèles envoyées par l'enseignant
   (Fiche N°2 CM2 « Endurance : courir pendant 6 min sans marcher ni s'arrêter », 3 pages) servent d'EXEMPLE DE MANIÈRE :
   pour chaque étape, l'IA reçoit le passage correspondant de la fiche modèle. Elle s'en inspire, sans le recopier. */
const EPS_MODELE_ACTIVITE = "Endurance : courir pendant 6 min sans marcher ni s'arrêter (CM2)";
const EPS_MODELES = {
  'presentation de l objet d apprentissage': { min: 3, image: true, text:
"• Voici l'image de la page n°24 du guide mise à ta disposition.\n• Tu es invité(e) à observer attentivement cette planche et à rendre compte librement de ton observation.\n• Décris l'activité à mener et l'atelier dans lequel elle doit se faire.\n• Dégage les mesures de sécurité à respecter.\n• Identifie les stratégies à mettre en œuvre pour une exécution correcte.\n• Évite d'être distrait(e)." },
  'expression de la perception': { min: 5, text:
"• Qu'est-ce qu'on te demande de faire ?\n• Quel comportement dois-tu adopter ?\n• Observe donc attentivement l'image mise à ta disposition.\n• Dis librement ce que tu as vu.\n• Exécute librement la course d'endurance (essais libres).\n• Observe celle de tes camarades.\n• Fais le point des différentes façons de réaliser une course d'endurance.\n• Compare-les." },
  'analyse': { min: 6, text:
"• Décris étape par étape l'image en répondant aux questions du maître :\n• Qui vois-tu sur cette image ?\n• Que font-ils ?\n• Sur quel terrain font-ils la course d'endurance ?\n• Dis comment tu peux réaliser la course d'endurance.\n• Quelles sont les stratégies à mettre en œuvre pour sa réalisation ?\n• Dis l'atelier approprié à cet égard.\n• Décris cet atelier.\n• Quelles sont les dispositions de sécurité à prendre ?\n• Propose un ordre chronologique d'apprentissage ou d'exécution des activités." },
  'prise de position': { min: 4, text:
"• Dis les difficultés rencontrées dans l'exécution de la course d'endurance.\n• Dis les différentes manières dont tes camarades et toi avez présenté la course d'endurance.\n• Compare-les à celles de l'image.\n• Retiens la meilleure façon de faire la course d'endurance.\n• Dis les bonnes stratégies utilisées. Retiens-les." },
  'engagement dans l action ou execution': { min: 3, text:
"• Exécute, toi seul puis avec un partenaire, correctement la course d'endurance en respectant les règles.\n• Multiplie les applications.\n• Tiens compte, chaque fois, des observations qui te sont faites." },
  'objectivation': { min: 3, text:
"• Dis ce que tu as appris et comment tu l'as appris.\n• Dis ce qui a particulièrement retenu ton attention.\n• Dis les difficultés rencontrées et comment tu les as surmontées." },
  'evaluation': { min: 2, text:
"• Quelle activité sportive de la maîtrise du corps as-tu menée ?\n• Exécute la course d'endurance à travers une compétition entre camarades de classe." },
  'projection': { min: 2, text:
"• Dis ce que tu feras des connaissances et techniques acquises.\n• À quelle occasion vas-tu utiliser la course d'endurance que tu as apprise ?" },
  'retour au calme ou exercices de relaxation': { min: 2, text:
"• Mène l'activité suivante :\n• N°1 : assis en tailleur : assis, mains aux hanches, jambes croisées." },
  'reprise en main': { min: 4, text:
"• Range le matériel.\n• Forme les rangs avec tes camarades.\n• Marche aux pas cadencés vers la classe.\n• Fais les ablutions : lavage des mains, de la figure, des bras avec de l'eau ; séchage des mains." }
};
function epsKey(label) {
  return String(label || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
}
function isEpsMatiere(matiere) { return /^\s*eps\s*$/i.test(String(matiere || '')); }

function buildEpsDevelopPrompt(matiere, classe, titre, demarche, item, modele, resume, seed, escalate) {
  const isMise = false;
  const consigneSpecifique = {
    'reprise en main': "Garde les 4 gestes de la démarche (ranger le matériel, former les rangs, marcher aux pas cadencés en chantant vers la classe, faire les ablutions) et précise-les pour CETTE activité (quel matériel ranger, comment le ranger, quelles ablutions : mains, figure, bras ; séchage).",
    'retour au calme ou exercices de relaxation': "Décris UN exercice simple de retour au calme ou de relaxation adapté à l'effort de la séance, en 2 à 4 consignes courtes (position de départ, mouvement lent, respiration). Ne cite un numéro d'exercice du guide que s'il figure dans le texte de base.",
    'projection': "Garde les deux questions de la démarche et ajoute une ou deux questions concrètes sur l'usage de l'activité du titre dans la vie de l'élève (jeux, sport, santé, école, quartier).",
    'evaluation': "Garde l'esprit de la démarche (production individuelle ou compétition) et précise l'épreuve : ce que l'élève doit exécuter, comment (seul, par deux, par équipes), et le critère de réussite à observer."
  }[epsKey(item.label)] || '';
  return `Tu aides un(e) enseignant(e) du primaire au Bénin à rédiger une fiche pédagogique d'Éducation Physique et Sportive (EPS).

Matière : EPS
Classe : ${classe || '(non précisée)'}
Titre de la séance (l'activité sportive à apprendre) : "${titre}"

Démarche d'EPS (suis-la : mêmes étapes, même ordre) :
${demarche}

${resume ? buildResumeBloc(resume) : ''}${buildVariationBloc(titre, seed, false)}Champ à rédiger : "${item.label}"
Texte de la démarche pour ce champ (ce sont les ÉTAPES à respecter, dans cet ordre ; c'est le squelette, pas le texte final) :
"""
${item.base}
"""

Exemple de MANIÈRE de développer cette étape, tiré d'une fiche modèle de l'enseignant sur une AUTRE activité (« ${EPS_MODELE_ACTIVITE} ») :
"""
${modele.text}
"""
Observe comment la fiche modèle rend chaque étape concrète : questions précises, observation d'une image, terrain ou atelier, mesures de sécurité, règles, stratégies, essais libres puis exécution avec un partenaire, compétition entre camarades. Inspire-toi de cette MANIÈRE, sans recopier ses phrases et sans parler d'endurance ni de course si le titre n'en parle pas.

Ta tâche : DÉVELOPPER le texte de la démarche pour l'activité « ${titre} ». 
Exigences :
- Garde TOUTES les étapes du texte de la démarche, dans le même ordre et avec le même sens ; n'en ajoute aucune qui serait étrangère à la démarche.
- Développe chaque étape en consignes concrètes propres à « ${titre} » : gestes à réaliser, terrain ou atelier, matériel, organisation (en file, par deux, en groupes), mesures de sécurité, règles de l'activité, stratégies de réussite, critère de réussite.
- ${modele.min} à 9 consignes au total, UNE phrase courte par consigne, au tutoiement, avec un verbe d'action ou une question directe à l'élève.
- Une consigne par ligne, chacune commençant par « • ».
- N'écris PAS les réponses attendues (elles figurent dans une autre colonne de la fiche) et n'ajoute aucun titre ni commentaire.
- Utilise des synonymes et des tournures personnelles : cette fiche ne doit pas ressembler à celles des autres enseignants qui suivent la même démarche.
${consigneSpecifique ? '- Pour ce champ : ' + consigneSpecifique + '\n' : ''}${escalate ? "- ATTENTION : ta première réponse était trop courte ou trop proche du texte de la démarche. Développe davantage, avec des consignes concrètes propres à l'activité du titre.\n" : ''}${modele.image ? IMAGE_INSTRUCTION : ''}
Réponds UNIQUEMENT avec le texte final du champ${modele.image ? " (suivi, au besoin, de la ligne [IMAGE: …])" : ''} : pas de titre, pas de JSON, pas de commentaire.`;
}

async function generateEpsDevelop(env, matiere, classe, titre, demarche, item, resume, seed) {
  const modele = EPS_MODELES[epsKey(item.label)];
  if (!modele) return null;
  const base = String(item.base || '').trim();
  const wanted = Math.max(modele.min, lineCount(base) + 1);
  let best = '';
  let image = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await runAi(env, null, {
      prompt: buildEpsDevelopPrompt(matiere, classe, titre, demarche, item, modele, resume, seed, attempt > 0),
      max_tokens: 2400,
      temperature: attempt === 0 ? 0.7 : 0.85
    });
    const parts = splitImage((result && result.response) || '');
    if (parts.image && !image) image = parts.image;
    const text = cleanPlain(parts.text, item.label);
    if (text && text.length > best.length) best = text;
    // Assez développé (nombre de consignes et longueur), et plus long que la démarche seule : on s'arrête là.
    if (text && lineCount(text) >= wanted && text.length >= base.length * 1.15) return { text, image };
  }
  return { text: best, image };
}

/* ---------- Éducation artistique (CE1-CM2) : dessin libre, dessin systématique, poésie, conte, chant ----------
   Demande du 25/10/2026 : en Mode Assisté, ces matières ne renvoient plus seulement les textes de la démarche : l'IA
   DÉVELOPPE les activités et les consignes (même principe que l'EPS, mais sans fiche modèle : chaque matière a un guide
   de concrétisation). Le contenu d'un poème, d'un conte ou d'un chant n'est jamais inventé : seul le déroulement l'est. */
const ART_GUIDES = {
  'dessin libre': "Matière : dessin libre (dessin de son choix, sans objet imposé). Concrétise : le choix du sujet par l'élève, le matériel (papier, crayons à papier, gomme, crayons de couleurs), les gestes (tracer d'abord légèrement les grandes formes, puis les détails, puis colorier), l'organisation de la page, la présentation du dessin aux camarades et les questions de compréhension posées à l'auteur. Le maître n'intervient pas sur le travail de l'élève.",
  'dessin systematique': "Matière : dessin systématique (dessin d'un objet précis donné par le titre). Concrétise pour l'objet du titre : l'observation libre puis dirigée (forme et proportions, parties de l'objet, rapports entre les parties, articulations et dimensions, occupation de l'espace sur la feuille), le matériel, les gestes de souplesse des mains, le tracé en première forme au crayon sans appuyer (pour effacer et réajuster), la comparaison avec l'objet, l'amélioration, les couleurs, le choix du meilleur dessin par groupe.",
  'poesie': "Matière : poésie (le titre donne le poème). Concrétise : lecture expressive, questions de compréhension sur le message, découpage en strophes, lecture courante (ponctuation, rythme, intonation, éloquence), repérage des rimes et des vers qui se ressemblent, personnages, échanges entre camarades, correction des erreurs au fur et à mesure, récitation individuelle. N'invente PAS les vers ni le contenu précis du poème : formule des consignes valables pour le poème du titre.",
  'conte': "Matière : conte (le titre donne le conte). Concrétise : conditions d'écoute (nattes, demi-cercle, lieu), animation (chant, gong, tam-tam, flûte), écoute attentive, questions sur les personnages, le lieu, la situation initiale, l'élément perturbateur, les réactions des personnages, la situation finale, le message. N'invente PAS l'histoire : formule des consignes valables pour le conte du titre, sans raconter d'événements précis.",
  'chant': "Matière : chant (le titre donne le chant). Concrétise : disposition des élèves, exercices de voix (respiration, échauffement), écoute du chant, appréciation, explication du message, apprentissage phrase musicale par phrase musicale (groupe-classe, sous-groupes, individu), reprise et enchaînement des phrases, rythme et justesse, instruments (mains, gong, castagnette, tam-tam). N'invente PAS les paroles du chant."
};
const ART_VARIATION_NOTE = "Pour cette matière, le décor, les prénoms et la forme ne servent qu'à varier l'organisation et les exemples de consignes (lieu, matériel, mise en groupes, questions) : ils ne doivent JAMAIS servir à inventer le contenu du poème, du conte ou du chant, ni l'objet du dessin. Choisis des activités, des questions et des formulations différentes de celles qu'on trouve habituellement pour ce titre.\n\n";
function isArtMatiere(matiere) { return !!ART_GUIDES[epsKey(matiere)]; }
function buildArtDevelopPrompt(matiere, classe, titre, demarche, item, escalate, seed) {
  const key = epsKey(item.label);
  const courts = { 'proposition de nouvelles acquisitions': 2, 'projection': 2, 'reinvestissement': 2, 'deuxieme execution': 2, 'codification du texte': 2, 'message du conte': 2, 'reconstitution du conte': 3 };
  const min = courts[key] || Math.max(3, Math.min(6, lineCount(item.base) + 1));
  return `Tu aides un(e) enseignant(e) du primaire au Bénin à rédiger une fiche pédagogique d'éducation artistique.

Matière : ${matiere}
Classe : ${classe || '(non précisée)'}
Titre de la séance : "${titre}"

${ART_GUIDES[epsKey(matiere)]}

Démarche (suis-la : mêmes étapes, même ordre) :
${demarche}

${buildVariationBloc(titre, seed, false)}${ART_VARIATION_NOTE}Champ à rédiger : "${item.label}"
Texte de la démarche pour ce champ (ce sont les ÉTAPES à respecter, dans cet ordre ; c'est le squelette, pas le texte final) :
"""
${item.base}
"""

Ta tâche : DÉVELOPPER ce texte en activités et consignes concrètes pour « ${titre} ».
Exigences :
- Garde TOUTES les étapes du texte de la démarche, dans le même ordre et avec le même sens ; n'en ajoute aucune qui serait étrangère à la démarche.
- Développe chaque étape : qui fait quoi, avec quel matériel, comment (seul, par deux, en groupes, en classe entière), quelles questions précises poser à l'élève, quel critère de réussite.
- ${min} à 8 consignes au total, UNE phrase courte par consigne, au tutoiement, avec un verbe d'action ou une question directe à l'élève.
- Une consigne par ligne, chacune commençant par « • ».
- N'écris PAS les réponses attendues (elles figurent dans une autre colonne de la fiche) et n'ajoute aucun titre ni commentaire.
- Utilise des synonymes et des tournures personnelles : cette fiche ne doit pas ressembler à celles des autres enseignants qui suivent la même démarche.
${escalate ? "- ATTENTION : ta première réponse était trop courte ou trop proche du texte de la démarche. Développe davantage, avec des consignes concrètes.\n" : ''}
Réponds UNIQUEMENT avec le texte final du champ : pas de titre, pas de JSON, pas de commentaire.`;
}
async function generateArtDevelop(env, matiere, classe, titre, demarche, item, seed) {
  const base = String(item.base || '').trim();
  let best = '';
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await runAi(env, null, {
      prompt: buildArtDevelopPrompt(matiere, classe, titre, demarche, item, attempt > 0, seed),
      max_tokens: 2000,
      temperature: attempt === 0 ? 0.7 : 0.85
    });
    const text = cleanPlain(splitImage((result && result.response) || '').text, item.label);
    if (text && text.length > best.length) best = text;
    if (text && lineCount(text) >= Math.min(lineCount(base) + 1, 4) && text.length >= base.length * 1.15) return { text, image: '' };
  }
  return { text: best, image: '' };
}

async function generatePlain(env, matiere, classe, titre, demarche, item, resume, seed) {
  if (item.mode === 'rephrase' && item.base) return generateRephrase(env, matiere, classe, titre, item);
  if (item.mode === 'develop' && item.base && isEpsMatiere(matiere)) {
    const eps = await generateEpsDevelop(env, matiere, classe, titre, demarche, item, resume, seed);
    if (eps && eps.text) return eps;   // sinon : repli sur le développement générique ci-dessous
  }
  if (item.mode === 'develop' && item.base && isArtMatiere(matiere)) {
    const art = await generateArtDevelop(env, matiere, classe, titre, demarche, item, seed);
    if (art && art.text) return art;   // sinon : repli sur le développement générique ci-dessous
  }
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


/* ---------- Maternelle — Domaine 3 : développement de la réflexion, aptitudes cognitives et intellectuelles ----------
   Démarches fournies le 25/10/2026 d'après les fiches manuscrites :
   - Pré-écriture (« J'apprends à bien m'asseoir pour écrire ») : problème → solution → pratique (3 activités) ;
   - Pré-lecture (« Je lis les éléments du coin construction ») : petite histoire d'un enfant qui veut savoir → 2 activités.
   Contrairement aux autres matières, tous les champs sont rédigés dans UN SEUL appel, pour que la leçon reste cohérente.
   Chaque section renvoie ses consignes (c) ET ses résultats attendus (r).
   Requête : { mode:'maternelle', composante, titre, classe (section), matiere, header:{capacite,habiletes,competences,materiel,theme}, seed, needMateriel }
   Réponse : { ok:true, sections:{ ms:{c,r}, acq, ann, a1, a2, [a3], eval, conn }, materiel? } */
const MAT_LABELS = {
  ms: 'Mise en situation', acq: 'Prise en compte des acquis antérieurs', ann: "Annonce de l'apprentissage du jour",
  a1: 'Activité N°1', a2: 'Activité N°2', a3: 'Activité N°3', jeux: 'Jeux', eval: 'Évaluation', conn: 'Connexion'
};
const MAT_COMMON_SPEC = {
  ann: `"ann" — ANNONCE DE L'APPRENTISSAGE DU JOUR. Exactement deux lignes : « • Aujourd'hui, tu vas apprendre à … » (reformule la capacité/le titre en un verbe à l'infinitif) puis « • Dis ce que tu vas apprendre aujourd'hui. » r : une ligne « Écoute. » puis ce que l'enfant dit (la leçon du jour).`,
  eval: `"eval" — ÉVALUATION. Une seule consigne qui vérifie l'habileté visée (« Décrire la manière de… », « Cite quelques éléments… », « Nomme… », « Montre comment… »). r : la réponse attendue, courte.`,
  conn: `"conn" — CONNEXION. Deux lignes : une question qui relie la leçon à la vie de l'enfant (« • Savais-tu qu'il faut … ? » ou « • Connaissais-tu … ? ») puis « • Et maintenant ? » r : « Réponses diverses » puis « Oui ».`
};
const MAT_MODELS = {
  ecriture: {
    keys: ['ms', 'acq', 'ann', 'a1', 'a2', 'a3', 'eval', 'conn'],
    fil: `Fil conducteur obligatoire : le problème posé dans la mise en situation est identifié dans « acq », puis résolu dans « a2 », puis pratiqué dans « a3 ».`,
    spec: Object.assign({
      ms: `"ms" — MISE EN SITUATION. Une consigne pour l'enseignant (« Faire observer aux enfants… ») qui présente UNE situation concrète, simple et visible, où le PROBLÈME de la leçon apparaît (par exemple un enfant qui fait mal ce que la leçon veut apprendre à bien faire, ou une chose qui manque). Elle ne donne pas la solution. 1 à 2 phrases. r : « L'enfant a vu… » + ce qu'il a vu.`,
      acq: `"acq" — PRISE EN COMPTE DES ACQUIS ANTÉRIEURS. 3 ou 4 questions courtes, une par ligne, posées SUR la mise en situation, pour faire SORTIR LE PROBLÈME POSÉ : « Dis ce que tu as vu. », « Comment est… ? », « Pourquoi… ? », « Que devrait-il faire ? ». r : les réponses attendues des enfants, qui nomment clairement le problème.`,
      a1: `"a1" — ACTIVITÉ N°1 : LES OUTILS. Montrer les outils/le matériel nécessaires pour réussir la leçon et leur utilité. Forme : « • Observe le matériel devant toi. » « • Nomme-le. » « • Dis son utilité. » (adapte au matériel réel de la leçon, 3 ou 4 lignes). r : « Observe », « Nomme (liste du matériel) », « Dit leur utilité ».`,
      a2: `"a2" — ACTIVITÉ N°2 : LA SOLUTION. Questions qui amènent les enfants à TROUVER LA SOLUTION du problème posé dans « acq » : « • Observe à nouveau… », « • Que dois-tu faire ? », « • Décris la manière de… ». 2 à 4 lignes. r : la solution attendue, sous forme de petites règles claires (« Bien… », « Éviter de… »), une par ligne.`,
      a3: `"a3" — ACTIVITÉ N°3 : PRATIQUE. Les enfants mettent la solution en pratique : 4 à 6 consignes d'action à l'impératif (« • Positionne-toi correctement. », « • Prends… »), puis EXACTEMENT ces trois dernières lignes : « • L'adulte corrige les mauvais gestes. » « • Encourage les timides. » « • Félicite ceux qui ont réussi. » r : « Exécute les gestes demandés » (une courte phrase précise).`
    }, MAT_COMMON_SPEC),
    example: `Modèle de FORME (autre leçon, ne pas recopier) — leçon « J'apprends à bien m'asseoir pour écrire » :
ms.c : « • Faire observer aux enfants l'écriture d'un enfant qui est mal assis pour écrire. » ms.r : « L'enfant a vu l'écriture penchée. »
acq.c : « • Dis ce que tu as vu.\\n• Dis comment est l'écriture de cet enfant.\\n• Pourquoi son écriture est-elle penchée ?\\n• Que devrait-il faire ? » acq.r : « Il a dit que l'écriture est penchée parce que l'enfant est mal assis ; il doit bien s'asseoir pour écrire. »
ann.c : « • Aujourd'hui, tu vas apprendre à bien t'asseoir pour écrire.\\n• Dis ce que tu vas apprendre aujourd'hui. »
a1.c : « • Observe le matériel devant toi.\\n• Nomme-le.\\n• Dis son utilité. » a1.r : « Observe ; nomme l'ardoise, la craie, le chiffon, le bic ; dit leur utilité. »
a2.c : « • Observe à nouveau l'écriture de ton ami.\\n• Que dois-tu faire ?\\n• Décris la manière de t'asseoir pour bien écrire. » a2.r : « Bien se positionner sur la chaise, le dos bien droit.\\nBien tenir la craie ou le bic.\\nÉviter de s'abaisser pour écrire. »`
  },
  sensorielle: {
    keys: ['ms', 'acq', 'ann', 'a1', 'a2', 'a3', 'eval', 'conn'],
    fil: `Fil conducteur obligatoire : la notion sensorielle du titre (une couleur, une forme, une taille, une matière au toucher, une odeur, un goût, un son…) apparaît dès la mise en situation (une scène de la vie courante), est demandée dans « acq », puis travaillée en 3 temps : a1 FAMILIARISATION ET ACQUISITION (observer, manipuler, nommer, caractériser), a2 EXPLOITATION DE LA NOTION ACQUISE (l'adulte montre, l'enfant nomme et caractérise), a3 VÉRIFICATION DES CONNAISSANCES (l'adulte nomme, l'enfant montre ; sériation ; recherche dans l'environnement). Toujours le MÊME objet-notion du titre dans toute la fiche. Pour le goût ou l'odeur, n'utilise que des aliments ou produits courants et sans danger.`,
    spec: Object.assign({
      ms: `"ms" — MISE EN SITUATION. Une scène de la vie courante en 2 consignes courtes, où apparaît un objet qui porte la notion du titre (ex. « • De retour du marché, maman apporte un ballon. » « • Regarde sa couleur. »). Adapte le sens utilisé à la notion (regarde, touche, sens, écoute, goûte). r : une ligne par consigne (« L'enfant a écouté. » puis « Regarde. »).`,
      acq: `"acq" — PRISE EN COMPTE DES ACQUIS ANTÉRIEURS. Exactement 2 lignes : « • Dis ce que tu as entendu. » puis une question qui fait dire la notion sur l'objet de la mise en situation (ex. « • Dis la couleur du ballon. »). r : « Rend compte. » puis « Réponses diverses (la notion attendue) ».`,
      a1: `"a1" — ACTIVITÉ N°1. PREMIÈRE LIGNE, sans puce : « Familiarisation et acquisition ». Puis 4 consignes : « • Observe le matériel devant toi. » « • Manipule-le. » « • Nomme-le. » « • Dis sa [couleur/forme/taille/…]. » r : « Observe. » « Manipule. » « Nomme le matériel. » + la notion attendue (ex. « Rouge. »).`,
      a2: `"a2" — ACTIVITÉ N°2. PREMIÈRE LIGNE, sans puce : « Exploitation de la notion acquise ». Puis : « • L'adulte montre le matériel, l'enfant nomme et caractérise. » « • Qu'est-ce que c'est ? » « • Quelle est sa [couleur/forme/…] ? » « • (Continuer jusqu'à épuisement du matériel.) » r : réponses attendues concrètes avec 1 ou 2 objets réels du matériel (ex. « Un gobelet. » « Rouge. »).`,
      a3: `"a3" — ACTIVITÉ N°3. PREMIÈRE LIGNE, sans puce : « Vérification des connaissances ». Puis : « • L'adulte nomme, l'enfant montre le matériel et le caractérise. » « • Prends le/la [objet]. » « • Montre-le/la. » « • Caractérise-le/la. (Quelle est sa … ?) » puis une SÉRIATION : « • Sériation : X, mets de côté tout le matériel [de la notion]. Y, vérifie le travail de ton ami. » puis « • Regarde autour de toi et identifie un objet [de la notion]. » r : « Pris le/la … » « Montré. » la notion attendue ; « Exécuté. » « Vérifié. » « Identifie… ».`,
      eval: `"eval" — ÉVALUATION. Une seule consigne pratique, adressée à un enfant désigné par X (ex. « • X, montre un peu de couleur rouge. »). r : « Exécuté. »`
    }, { ann: MAT_COMMON_SPEC.ann, conn: MAT_COMMON_SPEC.conn }),
    example: `Modèle de FORME (autre leçon, ne pas recopier) — leçon « J'apprends à identifier la couleur rouge » :
ms.c : « • De retour du marché, maman apporte un ballon.\\n• Regarde sa couleur. » ms.r : « L'enfant a écouté.\\nRegarde. »
acq.c : « • Dis ce que tu as entendu.\\n• Dis la couleur du ballon. » acq.r : « Rend compte.\\nRéponses diverses (rouge). »
ann.c : « • Aujourd'hui, tu vas apprendre à identifier la couleur rouge.\\n• Dis ce que tu vas apprendre aujourd'hui. » ann.r : « Écoute.\\nIdentifie la couleur rouge. »
a1.c : « Familiarisation et acquisition\\n• Observe le matériel devant toi.\\n• Manipule-le.\\n• Nomme-le.\\n• Dis sa couleur. » a1.r : « Observe.\\nManipule.\\nNomme le matériel.\\nRouge. »
a2.c : « Exploitation de la notion acquise\\n• L'adulte montre le matériel, l'enfant nomme et caractérise.\\n• Qu'est-ce que c'est ?\\n• Quelle est sa couleur ?\\n• (Continuer jusqu'à épuisement du matériel.) » a2.r : « Un gobelet.\\nRouge. »
a3.c : « Vérification des connaissances\\n• L'adulte nomme, l'enfant montre le matériel et le caractérise.\\n• Prends le ballon.\\n• Montre-le.\\n• Caractérise-le (quelle est sa couleur ?).\\n• Sériation : X, mets de côté tout le matériel rouge. Y, vérifie le travail de ton ami.\\n• Regarde autour de toi et identifie un objet de couleur rouge. » a3.r : « A pris le ballon.\\nMontré.\\nRouge.\\nExécuté.\\nVérifié.\\nIdentifie un objet rouge. »
eval.c : « • X, montre un peu de couleur rouge. » eval.r : « Exécuté. »
conn.c : « • Connaissais-tu la couleur rouge ?\\n• Et maintenant ? » conn.r : « Réponses diverses.\\nOui. »`
  },
  mathematique: {
    keys: ['ms', 'acq', 'ann', 'a1', 'a2', 'a3', 'eval', 'conn'],
    fil: `Fil conducteur obligatoire : le titre annonce l'acquisition d'UN concept pré-mathématique (concept spatial : devant, derrière, sur, sous, dans, à côté, entre, à gauche/à droite… ; ou comparaison : grand/petit, long/court, plus/moins ; ou classement, tri, quantité, comptage…). Toute la fiche utilise ce MÊME concept, entre guillemets « … » : une situation où on l'observe (ms) → une question pour le faire dire (acq) → découverte guidée avec du matériel (a1) → manipulation par chaque enfant (a2) → exercices sur images (a3) → évaluation pratique.`,
    spec: Object.assign({
      ms: `"ms" — MISE EN SITUATION. Deux consignes pour l'enseignant, visibles et jouables en classe : une disposition d'enfants ou d'objets qui montre le concept (ex. « • Formation de rang par quelques enfants. » ), puis « • Demander aux enfants d'observer. » r : « L'enfant a observé. »`,
      acq: `"acq" — PRISE EN COMPTE DES ACQUIS ANTÉRIEURS. Une ou deux questions qui font dire le concept sur la disposition observée (ex. « • Dis où se trouve X par rapport à Y. », X et Y étant deux enfants ou objets). r : le concept attendu (ex. « Derrière. »).`,
      a1: `"a1" — ACTIVITÉ N°1. Présentation et découverte guidée, 4 à 5 lignes : « • Présentation du matériel aux enfants. » « • Les enfants manipulent, touchent et nomment. » « • L'adulte fait découvrir à l'enfant l'objet d'étude : … » avec une MANIPULATION CONCRÈTE modèle (placer un premier objet au centre de la classe, placer un deuxième objet selon le concept : ex. « placer un carton de sucre « derrière » la chaise ») puis « • Reprendre l'action trois fois avec d'autres matériels afin d'aider les enfants à comprendre l'objet d'étude. » r : une seule ligne « Vu. »`,
      a2: `"a2" — ACTIVITÉ N°2 : MANIPULATION PAR LES ENFANTS. Exactement 3 consignes de la forme « • X, prends [objet], mets-le « [concept] » [objet repère] et dis ce que tu fais. » (3 objets et 3 repères différents tirés du matériel de la classe, tu peux nommer X, Y, Z différemment). r : une seule ligne « Exécuté. »`,
      a3: `"a3" — ACTIVITÉ N°3 : EXERCICES SUR IMAGES (support à dessiner ou à présenter). Exactement 2 exercices, chacun décrivant brièvement l'image puis la consigne : « • Image : [ce qui est dessiné]. Demander à l'enfant de mettre une croix sur [l'élément situé selon le concept]. » « • Image : [ce qui est dessiné]. Demander à l'enfant de faire un rond autour de [l'élément situé selon le concept]. » r : une seule ligne « Exécuté. »`,
      eval: `"eval" — ÉVALUATION. Deux consignes pratiques adressées à deux enfants désignés : « • X, prends [objet], mets-le « [concept] » [repère]. » « • Y, mets-toi « [concept] » [repère, ex. la maîtresse]. » r : « Exécuté. » (une ligne par consigne).`,
      conn: `"conn" — CONNEXION. Deux lignes : « • Pourrais-tu utiliser le concept « [concept] » ? » (ou une question qui relie le concept à la vie de l'enfant : à la maison, au marché, dans la cour) puis « • Et maintenant ? » r : « Réponses diverses. » puis « Oui. »`
    }, { ann: MAT_COMMON_SPEC.ann }),
    example: `Modèle de FORME (autre leçon, ne pas recopier) — leçon « Acquisition du concept « derrière » » (thème : Mon cadre scolaire) :
ms.c : « • Formation de rang par quelques enfants.\\n• Demander aux enfants d'observer. » ms.r : « L'enfant a observé. »
acq.c : « • Dis où se trouve X par rapport à Y. » acq.r : « Derrière. »
ann.c : « • Aujourd'hui, tu vas apprendre à utiliser le concept « derrière ».\\n• Dis ce que tu vas apprendre aujourd'hui. » ann.r : « Écoute.\\nDit ce qu'il va apprendre. »
a1.c : « • Présentation du matériel aux enfants.\\n• Les enfants manipulent, touchent et nomment.\\n• L'adulte fait découvrir à l'enfant l'objet d'étude : placer une chaise au centre de la classe, placer un carton de sucre « derrière » la chaise.\\n• Reprendre l'action trois fois avec d'autres matériels afin d'aider les enfants à comprendre l'objet d'étude. » a1.r : « Vu. »
a2.c : « • X, prends le chiffon, mets-le « derrière » le sac et dis ce que tu fais.\\n• Y, prends le bic, mets-le « derrière » la voiturette et dis ce que tu fais.\\n• Z, prends la boîte de lait, mets-la « derrière » la poupée et dis ce que tu fais. » a2.r : « Exécuté. »
a3.c : « • Image : une bouteille devant un poisson, une bouteille derrière. Demander à l'enfant de mettre une croix sur la bouteille qui est « derrière ».\\n• Image : une mère poule et deux poussins. Demander à l'enfant de faire un rond autour du poussin qui est « derrière » la mère poule. » a3.r : « Exécuté. »
eval.c : « • X, prends la craie, mets-la « derrière » la chaise.\\n• Y, mets-toi « derrière » la maîtresse. » eval.r : « Exécuté.\\nExécuté. »
conn.c : « • Pourrais-tu utiliser le concept « derrière » ?\\n• Et maintenant ? » conn.r : « Réponses diverses.\\nOui. »`
  },
  observation: {
    keys: ['ms', 'acq', 'ann', 'a1', 'a2', 'a3', 'eval', 'conn'],
    fil: `Fil conducteur obligatoire : le titre annonce l'observation d'UN objet, être vivant, plante, fruit ou élément du cadre de vie (ex. « J'observe la castagnette »). Toute la fiche porte sur ce MÊME élément : une scène qui le fait remarquer sans le nommer (ms) → les enfants disent ce qu'ils ont perçu et le nomment (acq) → a1 OBSERVATION LIBRE (observer, nommer, dire de quoi il est constitué) → a2 OBSERVATION DIRIGÉE (l'adulte attire l'attention sur les parties perçues : couleur, forme, taille, matière…) → a3 UTILITÉ (à quoi il sert, comment l'utiliser/en prendre soin, d'où il vient). Reste exact : n'invente aucun fait faux sur l'élément observé ; si tu hésites, reste général.`,
    spec: Object.assign({
      ms: `"ms" — MISE EN SITUATION. Une consigne courte (1 phrase) qui fait percevoir l'élément par un sens sans le nommer (ex. « • Pour réclamer le silence, la maîtresse secoue un objet. »). r : « L'enfant a écouté. » (ou « a regardé » selon le sens).`,
      acq: `"acq" — PRISE EN COMPTE DES ACQUIS ANTÉRIEURS. 3 ou 4 questions : « • Dis ce que tu as entendu/vu. » « • Dis le nom de l'objet… » « • En connais-tu les différentes parties ? » « • Aimerais-tu en connaître davantage ? » r : une ligne par question : « Rend compte. » ; le nom de l'élément ; « Réponses diverses. » ; « Oui. »`,
      a1: `"a1" — ACTIVITÉ N°1. PREMIÈRE LIGNE, sans puce : « Observation libre ». Puis : « • Observe attentivement le matériel mis à ta disposition. » « • Nomme-le. » « • Dis de quoi il est constitué. » r : « Observe. » ; le nom de l'élément ; la liste réelle de ses parties/matières (courte).`,
      a2: `"a2" — ACTIVITÉ N°2. PREMIÈRE LIGNE, sans puce : « Observation dirigée ». Puis : « • L'adulte attire l'attention des enfants sur les parties perçues. » puis 3 questions précises sur ces parties (couleur, forme, taille, matière, nombre… selon l'élément ; ex. « • Dis la couleur des perles. » « • Dis la forme des perles. »). r : « A réagi. » puis les réponses attendues réelles, une par question.`,
      a3: `"a3" — ACTIVITÉ N°3. PREMIÈRE LIGNE, sans puce : « Utilité ». Puis 4 à 6 consignes : « • Dis l'utilité de [l'élément]. » « • Utilise-le selon sa fonction. » (geste concret si possible) « • Que dois-tu faire pour ne pas l'abîmer/le casser ? » « • Dis la provenance de [ses matières principales]. » r : l'utilité réelle ; « Exécuté. » ; la règle de soin attendue ; la provenance réelle (brève).`,
      eval: `"eval" — ÉVALUATION. Une seule consigne : « • Cite les différentes parties de [l'élément]. » (ou « Nomme… » / « Dis l'utilité… »). r : la liste attendue, courte.`,
      conn: `"conn" — CONNEXION. Deux lignes : « • Connaissais-tu les différentes parties de [l'élément] ? » puis « • Et maintenant ? » r : « Réponses diverses. » puis « Oui. »`
    }, { ann: MAT_COMMON_SPEC.ann }),
    example: `Modèle de FORME (autre leçon, ne pas recopier) — leçon « J'observe la castagnette » (thème : Mon cadre scolaire) :
ms.c : « • Pour réclamer le silence, la maîtresse secoue un objet. » ms.r : « L'enfant a écouté. »
acq.c : « • Dis ce que tu as entendu.\\n• Dis le nom de l'objet secoué par la maîtresse.\\n• En connais-tu les différentes parties ?\\n• Aimerais-tu en connaître davantage ? » acq.r : « Rend compte.\\nLa castagnette.\\nRéponses diverses.\\nOui. »
ann.c : « • Aujourd'hui, tu vas apprendre à observer la castagnette.\\n• Dis ce que tu vas apprendre aujourd'hui. » ann.r : « Écoute.\\nObserve la castagnette. »
a1.c : « Observation libre\\n• Observe attentivement le matériel mis à ta disposition.\\n• Nomme-le.\\n• Dis de quoi est constituée la castagnette. » a1.r : « Observe.\\nCastagnette.\\nPerles, fil, calebasse, fer. »
a2.c : « Observation dirigée\\n• L'adulte attire l'attention des enfants sur les parties perçues.\\n• Dis la couleur des perles.\\n• Dis la forme des perles.\\n• Dis la forme des différentes castagnettes. » a2.r : « A réagi.\\nRéponses diverses (rouge, bleu…).\\nRondes.\\nEn calebasse, en fer. »
a3.c : « Utilité\\n• Dis l'utilité de la castagnette.\\n• Utilise la castagnette selon sa fonction : chante, joue la castagnette et danse.\\n• Que dois-tu faire pour ne pas casser la castagnette ?\\n• Dis la provenance de la calebasse.\\n• Dis la provenance des perles. » a3.r : « Cadencer les chansons.\\nExécuté.\\nLa manipuler avec soin.\\nElle vient d'une plante, le calebassier.\\nElles viennent du marché. »
eval.c : « • Cite les différentes parties de la castagnette. » eval.r : « Perles, fil, fer. »
conn.c : « • Connaissais-tu les différentes parties de la castagnette ?\\n• Et maintenant ? » conn.r : « Réponses diverses.\\nOui. »`
  },
  manuels: {
    keys: ['ms', 'acq', 'ann', 'a1', 'a2', 'a3', 'eval', 'conn'],
    fil: `Fil conducteur obligatoire : le titre annonce un GESTE technique et/ou une PRODUCTION d'arts manuels adaptés à la maternelle (déchirer, coller, plier, modeler, enfiler, découper avec des ciseaux à bouts ronds, tresser, peindre avec les doigts…). Toute la fiche porte sur ce MÊME geste/cette même production : un besoin concret (ms) → les enfants disent ce qu'on peut faire (acq) → a1 DÉCOUVERTE DU MATÉRIEL (observer, nommer, utilité, toucher) → a2 DÉMONSTRATION PAR L'ADULTE ET ESSAIS GUIDÉS (l'adulte fait lentement en disant ses gestes ; les enfants disent l'ordre des étapes ; premier essai accompagné) → a3 RÉALISATION (l'enfant réalise sa production étape par étape ; l'adulte corrige, encourage, félicite) → évaluation du geste. Sécurité : n'utilise que du matériel sans danger pour des enfants de 3 à 5 ans (ciseaux à bouts ronds sous surveillance, colle non toxique) ; rappelle de ne pas gaspiller ni mettre le matériel à la bouche.`,
    spec: Object.assign({
      ms: `"ms" — MISE EN SITUATION. Une consigne courte (1 à 2 phrases) : un besoin ou un projet concret de la vie de la classe ou de la maison où la production serait utile (ex. « • Pour la fête de la classe, la maîtresse veut décorer le mur. »), sans annoncer le geste. r : « L'enfant a écouté. »`,
      acq: `"acq" — PRISE EN COMPTE DES ACQUIS ANTÉRIEURS. Deux questions : « • Dis ce que tu as entendu. » puis « • Que peut-on faire pour [le besoin de la mise en situation] ? » r : « Rend compte. » puis « Réponses diverses (… exemples réalistes dont la production visée) ».`,
      a1: `"a1" — ACTIVITÉ N°1. PREMIÈRE LIGNE, sans puce : « Découverte du matériel ». Puis : « • Observe le matériel devant toi. » « • Nomme-le. » « • Dis à quoi il sert. » et une consigne sensorielle sur la matière (ex. « • Touche le papier : comment est-il ? »). r : « Observe. » ; les noms réels du matériel ; leur utilité ; la propriété attendue.`,
      a2: `"a2" — ACTIVITÉ N°2. PREMIÈRE LIGNE, sans puce : « Démonstration et essais guidés ». Puis : « • L'adulte réalise le geste lentement, en disant ce qu'il fait. » « • Regarde bien mes mains. » « • Que fais-je d'abord ? Ensuite ? » « • Essaie une fois, avec l'aide de l'adulte. » r : « A observé la démonstration. » ; les étapes attendues dans l'ordre (court) ; « Essaie. »`,
      a3: `"a3" — ACTIVITÉ N°3. PREMIÈRE LIGNE, sans puce : « Réalisation ». Puis 4 à 6 consignes d'action à l'impératif, dans l'ordre exact des étapes de la production (ex. « • Prends le papier. » « • Déchire de petits morceaux. » « • Mets un peu de colle. » « • Colle sur le support. »), puis EXACTEMENT ces trois dernières lignes : « • L'adulte corrige les mauvais gestes. » « • Encourage les timides. » « • Félicite ceux qui ont réussi. » r : « Exécute chaque geste. » puis « A réalisé sa production. »`,
      eval: `"eval" — ÉVALUATION. Une consigne pratique adressée à un enfant désigné par X : refaire le geste appris (ex. « • X, déchire et colle trois morceaux de papier. ») ou montrer sa production et dire comment il l'a faite. r : « Exécuté. »`,
      conn: `"conn" — CONNEXION. Deux lignes : une question qui relie le geste à la vie de l'enfant (« • Savais-tu que tu pouvais [usage de la production] avec … ? ») puis « • Et maintenant ? » r : « Réponses diverses. » puis « Oui. »`
    }, { ann: MAT_COMMON_SPEC.ann }),
    example: `Modèle de FORME (autre leçon, ne pas recopier) — leçon « Je déchire et je colle du papier » :
ms.c : « • Pour la fête de la classe, la maîtresse veut décorer le mur. » ms.r : « L'enfant a écouté. »
acq.c : « • Dis ce que tu as entendu.\\n• Que peut-on faire pour décorer le mur ? » acq.r : « Rend compte.\\nRéponses diverses (dessiner, coller des papiers…). »
ann.c : « • Aujourd'hui, tu vas apprendre à déchirer et à coller du papier.\\n• Dis ce que tu vas apprendre aujourd'hui. » ann.r : « Écoute.\\nDéchire et colle du papier. »
a1.c : « Découverte du matériel\\n• Observe le matériel devant toi.\\n• Nomme-le.\\n• Dis à quoi il sert.\\n• Touche le papier : comment est-il ? » a1.r : « Observe.\\nPapier, colle, support.\\nPour décorer.\\nMince, doux. »
a2.c : « Démonstration et essais guidés\\n• L'adulte déchire le papier et le colle lentement, en disant ce qu'il fait.\\n• Regarde bien mes mains.\\n• Que fais-je d'abord ? Ensuite ?\\n• Essaie une fois, avec l'aide de l'adulte. » a2.r : « A observé la démonstration.\\nJe déchire, je mets de la colle, je colle.\\nEssaie. »
a3.c : « Réalisation\\n• Prends le papier.\\n• Déchire de petits morceaux.\\n• Mets un peu de colle derrière chaque morceau.\\n• Colle les morceaux sur le support.\\n• L'adulte corrige les mauvais gestes.\\n• Encourage les timides.\\n• Félicite ceux qui ont réussi. » a3.r : « Exécute chaque geste.\\nA réalisé sa production. »
eval.c : « • X, déchire et colle trois morceaux de papier. » eval.r : « Exécuté. »
conn.c : « • Savais-tu que tu pouvais décorer avec du papier ?\\n• Et maintenant ? » conn.r : « Réponses diverses.\\nOui. »`
  },
  lecture: {
    keys: ['ms', 'acq', 'ann', 'a1', 'a2', 'eval', 'conn'],
    fil: `Fil conducteur obligatoire : la mise en situation est une PETITE HISTOIRE où un enfant (un camarade, avec un prénom béninois) veut connaître/lire quelque chose ; « acq » demande ce que les enfants ont entendu et comment cet enfant va faire pour le savoir ; « a1 » situe les enfants dans le lieu et rappelle la leçon du jour ; « a2 » fait observer, nommer/lire les éléments avec l'aide de l'adulte, puis rappelle de prendre soin du matériel.`,
    spec: Object.assign({
      ms: `"ms" — MISE EN SITUATION. Une petite histoire racontée (2 phrases) : à l'école, un camarade (prénom) reconnaît le lieu/le coin/l'objet de la leçon, mais désire savoir (lire) tout ce qu'il y a dedans. Elle ne donne pas la solution. r : « L'enfant a écouté. »`,
      acq: `"acq" — PRISE EN COMPTE DES ACQUIS ANTÉRIEURS. Exactement 2 lignes : « • Dis ce que tu as entendu. » puis « • Dis comment (prénom du camarade) va procéder pour connaître le nom de tout ce qu'il y a dans (le lieu/le coin). » r : une ligne par réponse : « Rend compte. » puis « Lit ou nomme les éléments de… ».`,
      a1: `"a1" — ACTIVITÉ N°1 : SE SITUER. Faire observer le lieu où l'on est et rappeler la leçon : « • Observe là où nous sommes. » « • Que fait-on ici ? » « • Rappel de l'apprentissage du jour. » (adapte au lieu/coin de la leçon). r : « Observe. » puis la réponse attendue à « Que fait-on ici ? » (ex. « On construit, on fabrique. »).`,
      a2: `"a2" — ACTIVITÉ N°2 : LIRE / NOMMER LES ÉLÉMENTS. « • Dis tout ce que tu vois. » « • Nomme-les. » puis une ligne « • L'adulte aide l'enfant à nommer le matériel et insiste sur ceux que l'enfant ne maîtrise pas. » puis trois consignes de soin, adaptées au matériel de la leçon (« • Prends soin du matériel. » « • Ne les déchire pas. » « • Ne les perds pas. » ou équivalent). r : « Exécuté. » ; « Essais de réponses : » + 2 ou 3 éléments réels du lieu (courts) ; puis « Écoute. » pour chaque consigne de soin.`
    }, MAT_COMMON_SPEC),
    example: `Modèle de FORME (autre leçon, ne pas recopier) — leçon « Je lis les éléments du coin construction » :
ms.c : « • À l'école, Baké, ton ami, reconnaît le coin construction mais désire savoir tout ce qu'il y a dans ce coin. » ms.r : « L'enfant a écouté. »
acq.c : « • Dis ce que tu as entendu.\\n• Dis comment Baké va procéder pour connaître le nom de tout ce qu'il y a dans ce coin. » acq.r : « Rend compte.\\nLit ou nomme les éléments du coin construction. »
ann.c : « • Aujourd'hui, tu vas apprendre à lire les éléments du coin construction.\\n• Dis ce que tu vas apprendre aujourd'hui. » ann.r : « Écoute.\\nLire les éléments du coin construction. »
a1.c : « • Observe là où nous sommes.\\n• Que fait-on ici ?\\n• Rappel de l'apprentissage du jour. » a1.r : « Observe.\\nOn construit, on fabrique. »
a2.c : « • Dis tout ce que tu vois.\\n• Nomme-les.\\n• L'adulte aide l'enfant à nommer le matériel de construction et insiste sur ceux que l'enfant ne maîtrise pas.\\n• Prends soin du matériel.\\n• Ne les déchire pas.\\n• Ne les perds pas. » a2.r : « Exécuté.\\nEssais de réponses : puzzles, jeux d'encastrement.\\nÉcoute.\\nÉcoute.\\nÉcoute. »
eval.c : « • Cite quelques éléments du coin construction. » eval.r : « Puzzles, jeux d'encastrement. »`
  }
};

/* ---------- Maternelle — Domaine 2 : bien-être physique et développement moteur (Éducation du mouvement) ----------
   Fiche modèle fournie le 25/10/2026 (« J'apprends à explorer l'aire de jeux »). Chaque section renvoie
   c = description des exercices, r = formation / évolution (ex. « En demi-cercle », « En file indienne »),
   d = dosage (ex. « 1 fois », « 2 ou 3 fois »). Prise en main, Mise en train, Retour, Projection,
   Retour au calme et Rangement sont des textes fixes (côté application). */
MAT_MODELS.mouvement = {
  domaine: "bien-être physique et développement moteur",
  hasDosage: true,
  keys: ['ms', 'acq', 'ann', 'a1', 'a2', 'jeux', 'eval', 'conn'],
  fil: `Fil conducteur obligatoire : le titre annonce un APPRENTISSAGE MOTEUR ou d'ÉDUCATION DU MOUVEMENT adapté à la maternelle (explorer l'aire de jeux, marcher, courir, sauter, ramper, lancer, équilibre, se déplacer en file, en cercle…). La mise en situation est une petite histoire où un camarade (prénom béninois) a une difficulté liée à ce sujet ; « acq » fait dire pourquoi il a cette difficulté et donne envie d'apprendre ; « ann » annonce l'apprentissage ; a1 et a2 sont deux activités MOTRICES successives (observer puis agir : se déplacer, se placer, exécuter) ; « jeux » propose un jeu de cercle ou un chant en rapport avec le titre ; « eval » vérifie par des consignes à montrer ou exécuter. Tout porte sur le MÊME apprentissage. Sécurité : mouvements simples, sans danger pour des enfants de 3 à 5 ans.`,
  spec: {
    ms: `"ms" — MISE EN SITUATION. Une petite histoire racontée (1 à 2 phrases) : un camarade (prénom) vient d'arriver ou rencontre une difficulté liée au sujet du titre (ex. « Baké, ton amie, est arrivée à l'école pour la première fois. Elle a du mal à utiliser le terrain tracé pour le sport. »). Elle ne donne pas la solution. d : « 1 fois ». r : « En demi-cercle ».`,
    acq: `"acq" — PRISE EN COMPTE DES ACQUIS ANTÉRIEURS. 3 questions courtes, une par ligne, commençant par « - » : « - Dis ce que tu as entendu. » « - Dis pourquoi (le camarade) a du mal à … » « - Veux-tu connaître et maîtriser … ? ». r : « En demi-cercle ».`,
    ann: `"ann" — ANNONCE DE L'APPRENTISSAGE DU JOUR. Exactement deux lignes : « - Aujourd'hui, tu vas apprendre à … » (reformule le titre avec un verbe à l'infinitif) puis « - Dis ce que tu vas apprendre aujourd'hui. » r : « En demi-cercle ».`,
    a1: `"a1" — ACTIVITÉ N°1 : OBSERVER ET SE REPÉRER. 4 à 5 consignes motrices ou d'observation à l'impératif, une par ligne, commençant par « - » (ex. « - Observe les tracés du terrain. » « - Observe l'entrée. » « - Évolue en ligne du côté droit pour parcourir le cercle tracé. » « - Quitte le point A pour le point B. »). Adapte au titre. r : la formation (« En ligne », « En demi-cercle »…). d : « 1 fois ».`,
    a2: `"a2" — ACTIVITÉ N°2 : EXÉCUTER. 4 consignes motrices à l'impératif, une par ligne, commençant par « - », qui font EXÉCUTER ce qui a été observé dans a1 (ex. « - Passe par l'entrée du terrain. » « - Évolue du côté droit. » « - Positionne-toi dans ta case. » « - Déplace-toi du point A vers le point B. »). r : « En demi-cercle ». d : « 1 ou 2 fois ».`,
    jeux: `"jeux" — JEUX. Une seule ligne : un jeu de cercle accompagné d'un chant traditionnel simple connu des enfants au Bénin ou d'une comptine (ex. « Jeux de cercle accompagné du chant Robototo. »), en rapport avec le thème. r : « En cercle ». d : « 2 fois ».`,
    eval: `"eval" — ÉVALUATION. 3 consignes courtes, une par ligne, commençant par « - », qui vérifient l'apprentissage du titre (ex. « - Montre l'entrée du terrain. » « - Montre la sortie du terrain. » « - Vers quel côté faut-il évoluer une fois dans le terrain ? »). r : « En demi-cercle ». d : « 1 fois ».`,
    conn: `"conn" — CONNEXION. Deux lignes : « - Connaissais-tu ou maîtrisais-tu … ? » (relie l'apprentissage à la vie de l'enfant) puis « - Et maintenant ? ». r : « En demi-cercle ».`
  },
  example: `Modèle de FORME (leçon « J'apprends à explorer l'aire de jeux », ne pas recopier) :
ms.c : « Baké, ton amie, est arrivée à l'école pour la première fois. Elle a du mal à utiliser le terrain tracé pour le sport. » ms.r : « En demi-cercle » ms.d : « 1 fois »
acq.c : « - Dis ce que tu as entendu.\\n- Dis pourquoi Baké a du mal à faire usage du terrain de sport.\\n- Veux-tu connaître et maîtriser l'aire de jeux ? » acq.r : « En demi-cercle »
ann.c : « - Aujourd'hui, tu vas apprendre à explorer l'aire de jeux.\\n- Dis ce que tu vas apprendre aujourd'hui. »
a1.c : « - Observe les tracés du terrain.\\n- Observe l'entrée.\\n- Évolue en ligne du côté droit pour parcourir le cercle tracé.\\n- Observe les tracés en bâtonnets debout au milieu du terrain.\\n- Quitte le point A pour le point B. »
a2.c : « - Passe par l'entrée du terrain.\\n- Évolue du côté droit.\\n- Positionne-toi dans ta case.\\n- Déplace-toi du point A vers le point B. » a2.r : « En demi-cercle » a2.d : « 1 ou 2 fois »
jeux.c : « Jeux de cercle accompagné du chant Robototo. »
eval.c : « - Montre l'entrée du terrain.\\n- Montre la sortie du terrain.\\n- Vers quel côté faut-il évoluer une fois dans le terrain ? »
conn.c : « - Connaissais-tu ou maîtrisais-tu l'usage du terrain de sport ?\\n- Et maintenant ? »`
};
/* ---------- Maternelle — Domaine 4 : développement des sentiments et des émotions (santé émotionnelle) ----------
   Fiches modèles fournies le 25/10/2026 :
   - Expression plastique (« J'apprends à déchirer du papier ») : observer le résultat → matériel → démonstration de la maîtresse → réalisation ;
   - Expression émotionnelle (« J'accepte mon nouveau cadre de vie ») : image d'un enfant → ressentis → rassurer → appuis. */
MAT_MODELS.plastique = {
  domaine: "développement des sentiments et des émotions (santé émotionnelle) — expression plastique",
  keys: ['ms', 'acq', 'ann', 'a1', 'a2', 'a3', 'eval', 'conn'],
  fil: `Fil conducteur obligatoire : le titre annonce un GESTE d'expression plastique simple adapté à la maternelle (déchirer, coller, plier, modeler, enfiler, barbouiller, peindre avec les doigts, découper avec des ciseaux à bouts ronds…). Toute la fiche porte sur ce MÊME geste : on fait observer des productions réalisées avec ce geste (ms) → les enfants disent ce qu'ils ont vu et comment on les a obtenues (acq) → a1 OBSERVER LE MATÉRIEL (observer, nommer, rappel de l'apprentissage) → a2 DÉMONSTRATION : les enfants observent la maîtresse faire le geste et disent comment elle a procédé → a3 RÉALISATION par chaque enfant (prise du matériel, bonne tenue des doigts, exécution, observation de sa production, comparaison avec celle de la maîtresse, expression de ses sentiments). Sécurité : matériel sans danger pour des enfants de 3 à 5 ans.`,
  spec: {
    ms: `"ms" — MISE EN SITUATION. UNE consigne pour l'enseignant : « • Faire observer aux enfants [des productions réalisées avec le geste du titre : ex. des papiers déchirés]. » r : « L'enfant a vu. »`,
    acq: `"acq" — PRISE EN COMPTE DES ACQUIS ANTÉRIEURS. 3 questions, une par ligne : « • Dis ce que tu as vu. » « • Dis comment sont les [productions] que tu as vues. » « • Comment a-t-on obtenu ces [productions] ? » r : une ligne par question : le nom de ce qu'ils ont vu, leur aspect (ex. « Déchirés. »), le geste (ex. « En déchirant. »).`,
    ann: MAT_COMMON_SPEC.ann,
    a1: `"a1" — ACTIVITÉ N°1 : LE MATÉRIEL. 3 lignes : « • Observe le matériel devant toi. » « • Nomme le matériel. » « • Rappel de l'apprentissage du jour. » r : « Vu. » puis les noms réels du matériel (court) puis une ligne vide ou « Écoute. »`,
    a2: `"a2" — ACTIVITÉ N°2 : DÉMONSTRATION. 2 lignes : « • Observe la maîtresse faire le [geste]. » « • Dis comment elle a procédé. » r : « A observé la maîtresse. » puis le procédé attendu en une courte phrase (ex. « Elle a déchiré le papier avec les doigts. »).`,
    a3: `"a3" — ACTIVITÉ N°3 : RÉALISATION. Consignes à l'impératif, une par ligne, dans l'ordre exact : « • X, prends [le matériel principal]. » puis 1 ou 2 consignes de TENUE/TECHNIQUE précises du geste (ex. « • Tiens le papier entre l'index et le pouce. » « • Sers-toi toujours de l'index et du pouce pour faire le déchirage. »), puis « • Observe ta production. » « • Compare-la à celle de la maîtresse. » « • Dis tes sentiments. » puis EXACTEMENT : « NB : L'enfant exécute le [geste] jusqu'à épuisement du matériel. L'adulte félicite ceux qui ont bien fait et encourage ceux qui éprouvent des difficultés. » r : une ligne par consigne qui appelle une action (ex. « A pris le papier A4. » « Exécuté. » « Comparé. » « Content. »).`,
    eval: `"eval" — ÉVALUATION. Deux consignes : « • X, prends [le matériel principal]. » « • Procède au [geste]. » r : « A pris … » puis « A procédé au … ».`,
    conn: `"conn" — CONNEXION. Deux lignes : « • Savais-tu [faire le geste du titre] ? » puis « • Et maintenant ? » r : « Réponses diverses. » puis « Oui. »`
  },
  example: `Modèle de FORME (leçon « J'apprends à déchirer du papier », ne pas recopier) :
ms.c : « • Faire observer aux enfants des papiers déchirés. » ms.r : « L'enfant a vu. »
acq.c : « • Dis ce que tu as vu.\\n• Dis comment sont les papiers que tu as vus.\\n• Comment a-t-on obtenu ces papiers ? » acq.r : « Papiers déchirés.\\nDéchirés.\\nEn déchirant. »
ann.c : « • Aujourd'hui, tu vas apprendre à faire le déchirage.\\n• Dis ce que tu vas apprendre aujourd'hui. » ann.r : « Écoute.\\nFaire le déchirage. »
a1.c : « • Observe le matériel devant toi.\\n• Nomme le matériel.\\n• Rappel de l'apprentissage du jour. » a1.r : « Vu.\\nPapier A4, feuilles. »
a2.c : « • Observe la maîtresse faire le déchirage.\\n• Dis comment elle a procédé. » a2.r : « A observé la maîtresse.\\nElle a déchiré. »
a3.c : « • X, prends le papier A4.\\n• Tiens le papier entre l'index et le pouce.\\n• Sers-toi toujours de l'index et du pouce pour faire le déchirage.\\n• Observe ta production.\\n• Compare-la à celle de la maîtresse.\\n• Dis tes sentiments.\\nNB : L'enfant exécute le déchirage jusqu'à épuisement du matériel. L'adulte félicite ceux qui ont bien fait et encourage ceux qui éprouvent des difficultés. » a3.r : « A pris le papier A4. Exécuté.\\nComparé.\\nContent. »
eval.c : « • X, prends la feuille de papier.\\n• Procède au déchirage. » eval.r : « A pris la feuille de papier.\\nA procédé au déchirage. »
conn.c : « • Savais-tu faire le déchirage ?\\n• Et maintenant ? » conn.r : « Réponses diverses.\\nOui. »`
};
MAT_MODELS.emotionnelle = {
  domaine: "développement des sentiments et des émotions (santé émotionnelle) — expression émotionnelle",
  keys: ['ms', 'acq', 'ann', 'a1', 'a2', 'a3', 'eval', 'conn'],
  fil: `Fil conducteur obligatoire : le titre annonce une COMPÉTENCE ÉMOTIONNELLE simple pour des enfants de 3 à 5 ans (accepter un nouveau cadre de vie, exprimer sa joie, dire sa peur ou sa colère, consoler un ami, attendre son tour, partager…). Toute la fiche porte sur ce MÊME thème, avec bienveillance : une image d'un enfant dans la situation (ms) → les enfants disent ce qu'ils voient, où est l'enfant, ce qu'il ressent et pourquoi (acq) → a1 LES RESSENTIS DES ENFANTS (« Dis-moi ce que tu ressens quand… », « Qu'est-ce qui te plaît… ? ») → a2 ACCUEILLIR LES PEURS/DIFFICULTÉS (question ouverte, l'enseignant accueille les réponses sans se moquer, l'adulte explique que c'est normal et que ça s'arrange petit à petit) → a3 TROUVER DES APPUIS (l'adulte insiste sur ce qui aide : jeux, coins de vie, amis, adultes ; consigne d'action ; l'adulte explique le bénéfice à long terme ; question finale « Avec ceci, … ? »). Ton doux, jamais de jugement ni de moquerie ; aucun sujet traumatisant.`,
  spec: {
    ms: `"ms" — MISE EN SITUATION. UNE consigne : « • L'adulte présente l'image d'un enfant qui [situation du titre : ex. arrive à l'école pour la première fois]. » r : « L'enfant a vu et observé. »`,
    acq: `"acq" — PRISE EN COMPTE DES ACQUIS ANTÉRIEURS. 4 questions, une par ligne : « • Que vois-tu sur l'image ? » « • Où est-il ? » « • Comment se sent-il ? » « • Pourquoi … (l'émotion) ? » r : une ligne par question (ex. « Un enfant. » « À l'école. » « Peur, triste. » « Parce que c'est sa première fois. »).`,
    ann: MAT_COMMON_SPEC.ann,
    a1: `"a1" — ACTIVITÉ N°1 : LES RESSENTIS. 2 questions personnelles : « • Dis-moi ce que tu ressens quand [situation du titre]. » « • Qu'est-ce qui te plaît dans [ton école / ta classe / … selon le titre] ? » r : une ligne par question avec 2 ou 3 réponses plausibles d'enfants (ex. « Tristesse, peur. » « Les jeux, les jouets. »).`,
    a2: `"a2" — ACTIVITÉ N°2 : ACCUEILLIR. « • Dis-moi, est-ce que quelque chose te fait [peur/de la peine…] à [situation] ? » puis « • L'enseignant accueille les réponses sans se moquer. » puis une ligne « • L'adulte explique aux enfants que c'est normal de [ressentir l'émotion] parce que … Mais petit à petit, … et on se sent mieux. » r : « Réponses diverses. » puis « Écoute. » (une ligne par consigne, même ordre).`,
    a3: `"a3" — ACTIVITÉ N°3 : TROUVER DES APPUIS. « • L'adulte insiste sur ce qui aide (jeux, coins de vie, amis…). » puis 1 ou 2 consignes d'action simples (ex. « • Observe le coin marchand, le coin poupée. » « • Peux-tu dans ces coins t'amuser ? »), puis « • L'adulte explique encore que … » (bénéfice à long terme, simple et vrai), puis une question finale « • Avec ceci, as-tu encore … ? » r : « Écoute. » ; « Observe. » ; … ; « Non ou réponses diverses. »`,
    eval: `"eval" — ÉVALUATION. UNE consigne qui fait dire le comportement visé : « • Dis pourquoi tu dois maintenant [accepter/…] ». r : la réponse attendue, courte (ex. « On se fait des amis et on joue. »).`,
    conn: `"conn" — CONNEXION. Deux lignes : « • Savais-tu ce que tu devrais [faire/accepter] ? » puis « • Et maintenant ? » r : « Réponses diverses. » puis « Oui. »`
  },
  example: `Modèle de FORME (leçon « J'accepte mon nouveau cadre de vie », ne pas recopier) :
ms.c : « • L'adulte présente l'image d'un enfant qui arrive à l'école pour la première fois. » ms.r : « L'enfant a vu et observé. »
acq.c : « • Que vois-tu sur l'image ?\\n• Où est-il ?\\n• Comment se sent-il ?\\n• Pourquoi a-t-il peur et pourquoi est-il triste ? » acq.r : « Un enfant.\\nÀ l'école.\\nPeur, triste.\\nParce que c'est sa première fois. »
ann.c : « • Aujourd'hui, tu vas apprendre à accepter ton nouveau cadre de vie.\\n• Dis ce que tu vas apprendre aujourd'hui. » ann.r : « Écoute.\\nAccepte son nouveau cadre de vie. »
a1.c : « • Dis-moi ce que tu ressens quand tu arrives à l'école.\\n• Qu'est-ce qui te plaît dans ton école et dans ta classe ? » a1.r : « Tristesse, peur (maman est partie).\\nLes jeux, les jouets. »
a2.c : « • Dis-moi, est-ce que quelque chose te fait peur à l'école ?\\n• L'enseignant accueille les réponses sans se moquer.\\n• L'adulte explique aux enfants que c'est normal d'avoir peur parce que tout est nouveau. Mais petit à petit, on découvre la classe, on se fait des amis, et on se sent mieux. » a2.r : « Réponses diverses.\\nÉcoute.\\nÉcoute. »
a3.c : « • L'adulte insiste sur les jeux (coins de vie).\\n• Observe le coin marchand, le coin poupée.\\n• Peux-tu dans ces coins t'amuser ?\\n• L'adulte explique encore qu'il faut aller à l'école pour devenir président, docteur…\\n• Avec ceci, as-tu encore peur de venir à l'école ? » a3.r : « Écoute.\\nObserve.\\nExécuté.\\nÉcoute.\\nNon ou réponses diverses. »
eval.c : « • Dis pourquoi tu dois maintenant accepter ton nouveau cadre de vie. » eval.r : « On se fait des amis et on joue. »
conn.c : « • Savais-tu ce que tu devrais accepter ton cadre de vie ?\\n• Et maintenant ? » conn.r : « Réponses diverses.\\nOui. »`
};
/* ---------- Maternelle — Domaine 5 : relations et interaction sociale et socio-affective ----------
   Fiches modèles fournies le 25/10/2026 : Poésie (« Mon école »), Conte (« Le premier jour de Koffi à l'école »),
   Communication orale (« J'apprends à dire bonjour »). */
const D5_DOMAINE = "développement des relations et de l'interaction sociale et socio-affective";
MAT_MODELS.poesie = {
  domaine: D5_DOMAINE + " — poésie",
  keys: ['ms', 'acq', 'ann', 'a1', 'a2', 'a3', 'eval', 'conn'],
  fil: `Fil conducteur obligatoire : le titre est celui d'une POÉSIE simple pour enfants de 3 à 5 ans (« Mon école », « Ma maman », « Le soleil »…). Toute la fiche porte sur cette poésie : récitation par la maîtresse (ms) → les enfants disent ce qu'ils ont entendu et s'ils veulent l'apprendre (acq) → a1 ÉCOUTE ATTENTIVE (l'adulte dit la poésie deux fois avec le ton, les gestes et le rythme ; les enfants disent ce qu'ils ont entendu et compris) → a2 SIGNIFICATION (l'adulte explique le contenu avec le matériel prévu ; les enfants disent ce qu'ils ont retenu ; nouvelle écoute) → a3 RÉPÉTITION (séquence par séquence, puis en sous-groupe et en groupe, puis individuellement) avec, en fin de « a3 », le TEXTE COMPLET de la poésie. Le texte de la poésie est une création ORIGINALE (jamais une poésie existante ni des paroles connues), de 4 à 6 vers très courts (3 à 7 mots), avec rimes ou assonances simples, vocabulaire de la vie des enfants, en rapport exact avec le titre.`,
  spec: {
    ms: `"ms" — MISE EN SITUATION. UNE consigne : « • Récitation d'une poésie par la maîtresse. » r : « L'enfant a écouté la poésie. »`,
    acq: `"acq" — PRISE EN COMPTE DES ACQUIS ANTÉRIEURS. 3 questions : « • Dis ce que tu as entendu. » « • Connais-tu une poésie ? » « • Veux-tu en apprendre ? » r : « A dit ce qu'il a entendu. » « Réponses diverses. » « Oui. »`,
    ann: `"ann" — ANNONCE DE L'APPRENTISSAGE DU JOUR. Deux lignes : « • Aujourd'hui, tu vas apprendre une nouvelle poésie. » puis « • Dis ce que tu vas apprendre aujourd'hui. » r : « A écouté. » puis « A dit : une poésie intitulée « [titre] ». »`,
    a1: `"a1" — ACTIVITÉ N°1 : ÉCOUTE. « • Écoute attentivement la poésie. (L'adulte présente deux fois la poésie en mettant le ton, les gestes et le rythme nécessaires.) » « • Dis ce que tu as entendu dans la poésie. » « • Dis ce que tu as compris du texte. » r : « A écouté. » « A dit ce qu'il a entendu. » « A dit ce qu'il a compris. »`,
    a2: `"a2" — ACTIVITÉ N°2 : SIGNIFICATION. « • Écoute la signification de ce texte. (L'adulte explique le contenu en se servant du matériel prévu.) » « • Dis ce que tu as retenu de l'explication. » « • Écoute à nouveau la poésie. » r : « A écouté la signification. » « A dit ce qu'il a retenu. » « A écouté. »`,
    a3: `"a3" — ACTIVITÉ N°3 : RÉPÉTITION ET TEXTE. « • Écoute et répète après moi. (L'adulte fait répéter le texte à l'enfant, séquence par séquence, avec le ton, les gestes, les expressions et la prononciation qu'il faut.) » « • Écoute et répète en sous-groupe, en groupe. » « • Écoute et répète individuellement. (Insister sur la répétition individuelle.) » puis une ligne « Poésie : [titre] » puis le TEXTE de la poésie (4 à 6 vers, un vers par ligne, sans puce). r : « Exécuté. » puis « Exécuté. » (une ligne par consigne d'action).`,
    eval: `"eval" — ÉVALUATION. UNE consigne : « • Dis la poésie apprise. » r : « A dit la poésie. »`,
    conn: `"conn" — CONNEXION. Deux lignes : « • Connaissais-tu cette poésie ? » puis « • Et maintenant ? » r : « Non. » puis « Réponses diverses. »`
  },
  example: `Modèle de FORME (poésie « Mon école », ne pas recopier) :
ms.c : « • Récitation d'une poésie par la maîtresse. » ms.r : « L'enfant a écouté la poésie. »
acq.c : « • Dis ce que tu as entendu.\\n• Connais-tu une poésie ?\\n• Veux-tu en apprendre ? » acq.r : « A dit ce qu'il a entendu.\\nRéponses diverses.\\nOui. »
ann.c : « • Aujourd'hui, tu vas apprendre une nouvelle poésie.\\n• Dis ce que tu vas apprendre aujourd'hui. » ann.r : « A écouté.\\nA dit : une poésie intitulée « Mon école ». »
a3.c : « • Écoute et répète après moi. (L'adulte fait répéter le texte à l'enfant, séquence par séquence, avec le ton, les gestes, les expressions et la prononciation qu'il faut.)\\n• Écoute et répète en sous-groupe, en groupe.\\n• Écoute et répète individuellement. (Insister sur la répétition individuelle.)\\nPoésie : Mon école\\nMon école est belle,\\nJ'y vais chaque matin.\\nMa maîtresse m'appelle,\\nNous jouons en chemin. » a3.r : « Exécuté.\\nExécuté. »
eval.c : « • Dis la poésie apprise. » eval.r : « A dit la poésie. »
conn.c : « • Connaissais-tu cette poésie ?\\n• Et maintenant ? » conn.r : « Non.\\nRéponses diverses. »`
};
MAT_MODELS.conte = {
  domaine: D5_DOMAINE + " — conte",
  keys: ['ms', 'acq', 'ann', 'a1', 'a2', 'a3', 'eval', 'conn'],
  fil: `Fil conducteur obligatoire : le titre est celui d'un CONTE très simple pour enfants de 3 à 5 ans, centré sur un petit héros (enfant ou animal, prénom béninois) et sur une valeur ou un comportement (« Le premier jour de Koffi à l'école »). Imagine d'abord, pour toi seul, ce petit conte en 6 à 7 événements chronologiques (le matin, la maman, l'arrivée à l'école, les amis, la maîtresse, les activités, le retour à la maison…) ; tes questions de « a2 » suivent cet ordre et tes réponses attendues (« r ») racontent le conte. Déroulé : l'adulte entonne le chant annonçant l'heure du conte et présente l'image principale (ms) → les enfants disent ce qu'ils ont entendu et vu, ce qu'ils savent de l'image (acq) → a1 ÉCOUTE ET COMPTE RENDU (écoute, dit ce qu'il a retenu, nouvelle écoute, dit ce qu'il a retenu de plus) → a2 CHRONOLOGIE DES FAITS (questions sur le héros dans l'ordre, puis classement des images séquentielles) → a3 SE SITUER PAR RAPPORT AU HÉROS (« où fais-tu comme X ? », « X est-il un bon élève/enfant ou pas ? », « Seras-tu comme X ? »). Valeurs positives, aucune violence.`,
  spec: {
    ms: `"ms" — MISE EN SITUATION. Deux consignes : « • L'adulte entonne le chant annonçant l'heure du conte. » « • L'adulte présente l'image principale du conte. » r : « L'enfant a écouté. » puis « Vu. »`,
    acq: `"acq" — PRISE EN COMPTE DES ACQUIS ANTÉRIEURS. 4 questions : « • Dis ce que tu as entendu. » « • Dis ce que tu as vu après le chant. » « • Dis ce que tu sais de cette image. » « • Dis un conte à partir de cette image. » r : « Un chant sur le conte. » ; ce qu'il y a sur l'image (ex. « Image d'un garçon. ») ; « Réponses diverses. » ; « Essais de réponses. »`,
    ann: `"ann" — ANNONCE DE L'APPRENTISSAGE DU JOUR. Deux lignes : « • Aujourd'hui, tu vas apprendre un nouveau conte intitulé « [titre] ». » puis « • Dis ce que tu vas apprendre aujourd'hui. » r : « Écoute. » puis « Un conte intitulé « [titre] ». »`,
    a1: `"a1" — ACTIVITÉ N°1 : ÉCOUTE. 4 consignes : « • Écoute attentivement le conte. » « • Dis ce que tu as retenu. » « • Écoute à nouveau le conte. » « • Dis ce que tu as retenu de plus. » r : « Écouté. » « Rendu compte. » « Écouté. » « Rendu compte. »`,
    a2: `"a2" — ACTIVITÉ N°2 : CHRONOLOGIE DES FAITS. Première ligne : « • Donne des réponses aux questions relatant la chronologie des faits. » puis 6 ou 7 questions précises sur le héros dans l'ordre du conte (« • Dis ce que [héros] a fait ce matin. » « • Que fait sa maman ? » « • Qui [héros] retrouve à l'école ? » « • Que fait la maîtresse ? » « • Comment est [héros] quand il voit ses amis ? » « • Que fait [héros] quand la maîtresse travaille ? » « • Que fait [héros] une fois à la maison le soir ? »), adaptées au conte imaginé ; puis « • Classe les images séquentielles. » r : une réponse courte et précise par question (qui racontent le conte), dans le même ordre ; puis « Exécuté. »`,
    a3: `"a3" — ACTIVITÉ N°3 : SE SITUER. 3 consignes : « • De tout ce que [héros] a fait, dis où tu fais comme [héros]. » « • [Héros] est un bon élève/enfant ou pas ? » « • Seras-tu comme [héros] ? » r : « Réponses diverses. » « Oui. » « Oui. »`,
    eval: `"eval" — ÉVALUATION. UNE consigne : « • X, dis le conte appris. » r : « A dit le conte. »`,
    conn: `"conn" — CONNEXION. Deux lignes : « • Connaissais-tu ce conte ? » puis « • Et maintenant ? » r : « Réponses diverses. » puis « Oui. »`
  },
  example: `Modèle de FORME (conte « Le premier jour de Koffi à l'école », ne pas recopier) :
ms.c : « • L'adulte entonne le chant annonçant l'heure du conte.\\n• L'adulte présente l'image principale du conte. » ms.r : « L'enfant a écouté.\\nVu. »
acq.c : « • Dis ce que tu as entendu.\\n• Dis ce que tu as vu après le chant.\\n• Dis ce que tu sais de cette image.\\n• Dis un conte à partir de cette image. » acq.r : « Un chant sur le conte.\\nImage d'un garçon.\\nRéponses diverses.\\nEssais de réponses. »
a2.c : « • Donne des réponses aux questions relatant la chronologie des faits.\\n• Dis ce que Koffi a fait ce matin.\\n• Que fait sa maman ?\\n• Qui Koffi retrouve à l'école ?\\n• Que fait la maîtresse ?\\n• Comment est Koffi quand il voit ses amis ?\\n• Que fait Koffi quand la maîtresse travaille ?\\n• Que fait Koffi une fois à la maison le soir ?\\n• Classe les images séquentielles. » a2.r : « Il se réveille très tôt.\\nElle lui prépare son sac.\\nSes amis.\\nElle accueille et montre aux enfants leurs classes.\\nIl est content.\\nIl suit et participe aux activités.\\nIl raconte comment il a passé sa journée.\\nExécuté. »
a3.c : « • De tout ce que Koffi a fait, dis où tu fais comme Koffi.\\n• Koffi est un bon élève ou pas ?\\n• Seras-tu comme Koffi ? » a3.r : « Réponses diverses.\\nOui.\\nOui. »
eval.c : « • X, dis le conte appris. » eval.r : « A dit le conte. »`
};
MAT_MODELS.commOrale = {
  domaine: D5_DOMAINE + " — communication orale",
  keys: ['ms', 'acq', 'ann', 'a1', 'a2', 'a3', 'eval', 'conn'],
  fil: `Fil conducteur obligatoire : le titre annonce une FORMULE DE POLITESSE ou une STRUCTURE de communication simple (dire bonjour, dire merci, demander s'il te plaît, dire au revoir, s'excuser…). Toute la fiche porte sur cette même structure (notée « S ») : une petite scène où une amie (prénom béninois) ne l'emploie pas (ms) → les enfants disent ce qu'elle a fait et ce qu'elle devait faire (acq) → a1 ÉCOUTER LA STRUCTURE (l'adulte invite les enfants à écouter la structure « S, X ») → a2 EMPLOI (l'adulte appelle X, Y, Z tour à tour pour employer la structure avec la maîtresse, puis avec un ami) → a3 TRANSFERT À LA MAISON (« À ton réveil le matin… », « À ton retour… » : employer la structure avec papa, maman…). Ton chaleureux, situations de la vie courante au Bénin.`,
  spec: {
    ms: `"ms" — MISE EN SITUATION. Une petite scène racontée (1 à 2 phrases) : une amie (prénom) vient à l'école le matin et dépasse sa maîtresse sans rien dire, puis va s'asseoir (adapte à la structure du titre). r : « L'enfant a écouté. »`,
    acq: `"acq" — PRISE EN COMPTE DES ACQUIS ANTÉRIEURS. 3 consignes : « • Dis ce que tu as entendu. » « • Dis ce qu'a fait ton amie. » « • Que devrait-elle faire avant d'aller s'asseoir ? » r : « Rend compte. » ; ce qu'elle a fait (ex. « A dépassé la maîtresse. ») ; ce qu'elle devait faire (ex. « Saluer. »).`,
    ann: MAT_COMMON_SPEC.ann,
    a1: `"a1" — ACTIVITÉ N°1 : ÉCOUTER LA STRUCTURE. UNE consigne : « • L'adulte invite les enfants à écouter la structure : « [formule du titre, ex. Bonjour, X] ». » r : « Écouté. »`,
    a2: `"a2" — ACTIVITÉ N°2 : EMPLOI. PREMIÈRE LIGNE, sans puce : « Emploi ». Puis : « X, viens. » « • Dis [formule] maîtresse. » « • Y, dis [formule] maîtresse. » « • Z, dis [formule] (à ton ami). » r : « Dit [formule]. » puis une ligne « — » ou « (à ton ami) » correspondant à la dernière consigne.`,
    a3: `"a3" — ACTIVITÉ N°3 : TRANSFERT. PREMIÈRE LIGNE, sans puce : « Transfert ». Puis une situation de la maison (ex. « À ton réveil le matin, ») et 2 consignes : « • Dis [formule] papa. » « • Dis [formule] maman. » r : « Exécuté. »`,
    eval: `"eval" — ÉVALUATION. UNE consigne : « • Dis ce que tu dois faire et dire quand tu viens à l'école. » (adapte à la structure). r : la réponse attendue, courte.`,
    conn: `"conn" — CONNEXION. Deux lignes : « • Savais-tu [dire la formule] de ton arrivée à l'école ? » puis « • Et maintenant ? » r : « Réponses diverses. » puis « Oui. »`
  },
  example: `Modèle de FORME (leçon « J'apprends à dire bonjour », ne pas recopier) :
ms.c : « • Sophie, l'une de tes amies, vient à l'école le matin. Elle dépasse sa maîtresse sans rien dire et va s'asseoir. » ms.r : « L'enfant a écouté. »
acq.c : « • Dis ce que tu as entendu.\\n• Dis ce qu'a fait ton amie.\\n• Que devrait-elle faire avant d'aller s'asseoir ? » acq.r : « Rend compte.\\nA dépassé la maîtresse.\\nSaluer. »
a1.c : « • L'adulte invite les enfants à écouter la structure : « Bonjour, X ». » a1.r : « Écouté. »
a2.c : « Emploi\\nX, viens.\\n• Dis bonjour maîtresse.\\n• Y, dis bonjour maîtresse.\\n• Z, dis bonjour maîtresse (à ton ami). » a2.r : « Dit bonjour. »
a3.c : « Transfert\\nÀ ton réveil le matin,\\n• Dis bonjour papa.\\n• Dis bonjour maman. » a3.r : « Exécuté. »
eval.c : « • Dis ce que tu dois faire et dire quand tu viens à l'école. » eval.r : « Dit bonjour à la maîtresse et à ses amis. »
conn.c : « • Savais-tu dire bonjour dès ton arrivée à l'école ?\\n• Et maintenant ? » conn.r : « Réponses diverses.\\nOui. »`
};
/* Comptine, Chant et Activités libres (propositions du 25/10/2026, à ajuster d'après les fiches modèles de l'enseignante). */
MAT_MODELS.comptine = {
  domaine: D5_DOMAINE + " — comptine",
  keys: ['ms', 'acq', 'ann', 'a1', 'a2', 'a3', 'eval', 'conn'],
  fil: `Fil conducteur obligatoire : le titre est celui d'une COMPTINE simple pour enfants de 3 à 5 ans (« Les doigts de la main », « Petit escargot », « Mon ballon »…). Toute la fiche porte sur cette comptine : récitation par la maîtresse avec les gestes (ms) → les enfants disent ce qu'ils ont entendu et s'ils veulent l'apprendre (acq) → a1 ÉCOUTE ET COMPRÉHENSION (l'adulte dit la comptine deux fois avec le ton, le rythme et les gestes ; les enfants disent ce qu'ils ont retenu et de quoi elle parle) → a2 RÉPÉTITION AVEC GESTES (séquence par séquence, puis en sous-groupe et en groupe) → a3 REPRODUCTION INDIVIDUELLE avec les gestes et, en fin de « a3 », le TEXTE COMPLET de la comptine. Le texte est une création ORIGINALE (jamais une comptine existante), de 4 à 6 lignes très courtes (3 à 6 mots), avec rimes ou répétitions simples, vocabulaire de la vie des enfants, en rapport exact avec le titre.`,
  spec: {
    ms: `\"ms\" — MISE EN SITUATION. UNE consigne : « • Récitation d'une comptine par la maîtresse, avec les gestes. » r : « L'enfant a écouté la comptine. »`,
    acq: `\"acq\" — PRISE EN COMPTE DES ACQUIS ANTÉRIEURS. 3 questions : « • Dis ce que tu as entendu. » « • Connais-tu une comptine ? » « • Veux-tu en apprendre une ? » r : « A dit ce qu'il a entendu. » « Réponses diverses. » « Oui. »`,
    ann: `\"ann\" — ANNONCE DE L'APPRENTISSAGE DU JOUR. Deux lignes : « • Aujourd'hui, tu vas apprendre une nouvelle comptine. » puis « • Dis ce que tu vas apprendre aujourd'hui. » r : « A écouté. » puis « A dit : une comptine intitulée « [titre] ». »`,
    a1: `\"a1\" — ACTIVITÉ N°1 : ÉCOUTE ET COMPRÉHENSION. « • Écoute attentivement la comptine. (L'adulte la dit deux fois en mettant le ton, le rythme et les gestes nécessaires.) » « • Dis ce que tu as retenu. » « • Dis de quoi parle la comptine. » r : « A écouté. » « A dit ce qu'il a retenu. » « A dit de quoi parle la comptine. »`,
    a2: `\"a2\" — ACTIVITÉ N°2 : RÉPÉTITION AVEC GESTES. « • Écoute et répète après moi, avec les gestes. (L'adulte fait répéter la comptine séquence par séquence.) » « • Écoute et répète en sous-groupe, en groupe. » r : « Exécuté. » « Exécuté. »`,
    a3: `\"a3\" — ACTIVITÉ N°3 : REPRODUCTION INDIVIDUELLE ET TEXTE. « • Dis la comptine avec les gestes, individuellement. (Insister sur la répétition individuelle.) » puis une ligne « Comptine : [titre] » puis le TEXTE de la comptine (4 à 6 lignes, une par ligne, sans puce). r : « Exécuté. »`,
    eval: `\"eval\" — ÉVALUATION. UNE consigne : « • Dis la comptine apprise. » r : « A dit la comptine. »`,
    conn: `\"conn\" — CONNEXION. Deux lignes : « • Connaissais-tu cette comptine ? » puis « • Et maintenant ? » r : « Non. » puis « Réponses diverses. »`
  },
  example: `Modèle de FORME (comptine « Les doigts de la main », ne pas recopier) :
ms.c : « • Récitation d'une comptine par la maîtresse, avec les gestes. » ms.r : « L'enfant a écouté la comptine. »
acq.c : « • Dis ce que tu as entendu.\\n• Connais-tu une comptine ?\\n• Veux-tu en apprendre une ? » acq.r : « A dit ce qu'il a entendu.\\nRéponses diverses.\\nOui. »
ann.c : « • Aujourd'hui, tu vas apprendre une nouvelle comptine.\\n• Dis ce que tu vas apprendre aujourd'hui. » ann.r : « A écouté.\\nA dit : une comptine intitulée « Les doigts de la main ». »
a1.c : « • Écoute attentivement la comptine. (L'adulte la dit deux fois en mettant le ton, le rythme et les gestes nécessaires.)\\n• Dis ce que tu as retenu.\\n• Dis de quoi parle la comptine. » a1.r : « A écouté.\\nA dit ce qu'il a retenu.\\nA dit de quoi parle la comptine. »
a2.c : « • Écoute et répète après moi, avec les gestes. (L'adulte fait répéter la comptine séquence par séquence.)\\n• Écoute et répète en sous-groupe, en groupe. » a2.r : « Exécuté.\\nExécuté. »
a3.c : « • Dis la comptine avec les gestes, individuellement. (Insister sur la répétition individuelle.)\\nComptine : Les doigts de la main\\nUn doigt, deux doigts,\\nJe compte avec toi.\\nTrois doigts, quatre doigts,\\nJe bouge mes doigts. » a3.r : « Exécuté. »
eval.c : « • Dis la comptine apprise. » eval.r : « A dit la comptine. »
conn.c : « • Connaissais-tu cette comptine ?\\n• Et maintenant ? » conn.r : « Non.\\nRéponses diverses. »`
};
MAT_MODELS.chant = {
  domaine: D5_DOMAINE + " — chant",
  keys: ['ms', 'acq', 'ann', 'a1', 'a2', 'a3', 'eval', 'conn'],
  fil: `Fil conducteur obligatoire : le titre est celui d'un CHANT simple pour enfants de 3 à 5 ans (« Bonjour mes amis », « Je range mes jouets », « L'école est belle »…). Toute la fiche porte sur ce chant : la maîtresse chante (ms) → les enfants disent ce qu'ils ont entendu et s'ils veulent l'apprendre (acq) → a1 ÉCOUTE ET COMPRÉHENSION (l'adulte chante deux fois ; les enfants disent ce que le chant raconte et les mots retenus) → a2 APPRENTISSAGE (phrase par phrase après l'adulte, puis en sous-groupe et en groupe) → a3 CHANT ET RYTHME (individuellement, puis en chantant et en frappant le rythme avec les mains ou la castagnette) avec, en fin de « a3 », les PAROLES COMPLÈTES du chant. Les paroles sont une création ORIGINALE (jamais un chant existant), de 4 à 6 lignes très courtes (3 à 7 mots), avec rimes ou refrain simples, vocabulaire de la vie des enfants, en rapport exact avec le titre.`,
  spec: {
    ms: `\"ms\" — MISE EN SITUATION. UNE consigne : « • Le chant est interprété par la maîtresse. » r : « L'enfant a écouté le chant. »`,
    acq: `\"acq\" — PRISE EN COMPTE DES ACQUIS ANTÉRIEURS. 3 questions : « • Dis ce que tu as entendu. » « • Connais-tu un chant ? » « • Veux-tu en apprendre un ? » r : « A dit ce qu'il a entendu. » « Réponses diverses. » « Oui. »`,
    ann: `\"ann\" — ANNONCE DE L'APPRENTISSAGE DU JOUR. Deux lignes : « • Aujourd'hui, tu vas apprendre un nouveau chant. » puis « • Dis ce que tu vas apprendre aujourd'hui. » r : « A écouté. » puis « A dit : un chant intitulé « [titre] ». »`,
    a1: `\"a1\" — ACTIVITÉ N°1 : ÉCOUTE ET COMPRÉHENSION. « • Écoute attentivement le chant. (L'adulte le chante deux fois en mettant le ton et le rythme nécessaires.) » « • Dis ce que raconte le chant. » « • Redis les mots que tu as retenus. » r : « A écouté. » « A dit ce que raconte le chant. » « A redit des mots. »`,
    a2: `\"a2\" — ACTIVITÉ N°2 : APPRENTISSAGE. « • Écoute et répète après moi, phrase par phrase. (L'adulte chante chaque phrase, les enfants la reprennent.) » « • Écoute et répète en sous-groupe, en groupe. » r : « Exécuté. » « Exécuté. »`,
    a3: `\"a3\" — ACTIVITÉ N°3 : CHANT ET RYTHME. « • Chante individuellement. (Insister sur le chant individuel.) » « • Chante en frappant le rythme avec les mains ou la castagnette. » puis une ligne « Chant : [titre] » puis les PAROLES du chant (4 à 6 lignes, une par ligne, sans puce). r : « Exécuté. » « Exécuté. »`,
    eval: `\"eval\" — ÉVALUATION. UNE consigne : « • Chante le chant appris. » r : « A chanté le chant. »`,
    conn: `\"conn\" — CONNEXION. Deux lignes : « • Connaissais-tu ce chant ? » puis « • Et maintenant ? » r : « Non. » puis « Réponses diverses. »`
  },
  example: `Modèle de FORME (chant « Bonjour mes amis », ne pas recopier) :
ms.c : « • Le chant est interprété par la maîtresse. » ms.r : « L'enfant a écouté le chant. »
acq.c : « • Dis ce que tu as entendu.\\n• Connais-tu un chant ?\\n• Veux-tu en apprendre un ? » acq.r : « A dit ce qu'il a entendu.\\nRéponses diverses.\\nOui. »
ann.c : « • Aujourd'hui, tu vas apprendre un nouveau chant.\\n• Dis ce que tu vas apprendre aujourd'hui. » ann.r : « A écouté.\\nA dit : un chant intitulé « Bonjour mes amis ». »
a1.c : « • Écoute attentivement le chant. (L'adulte le chante deux fois en mettant le ton et le rythme nécessaires.)\\n• Dis ce que raconte le chant.\\n• Redis les mots que tu as retenus. » a1.r : « A écouté.\\nA dit ce que raconte le chant.\\nA redit des mots. »
a2.c : « • Écoute et répète après moi, phrase par phrase. (L'adulte chante chaque phrase, les enfants la reprennent.)\\n• Écoute et répète en sous-groupe, en groupe. » a2.r : « Exécuté.\\nExécuté. »
a3.c : « • Chante individuellement. (Insister sur le chant individuel.)\\n• Chante en frappant le rythme avec les mains ou la castagnette.\\nChant : Bonjour mes amis\\nBonjour, bonjour,\\nBonjour mes amis,\\nOn chante, on danse,\\nÀ l'école aujourd'hui. » a3.r : « Exécuté.\\nExécuté. »
eval.c : « • Chante le chant appris. » eval.r : « A chanté le chant. »
conn.c : « • Connaissais-tu ce chant ?\\n• Et maintenant ? » conn.r : « Non.\\nRéponses diverses. »`
};
MAT_MODELS.libres = {
  domaine: D5_DOMAINE + " — activités libres",
  keys: ['ms', 'acq', 'ann', 'a1', 'a2', 'eval', 'conn'],
  fil: `Fil conducteur obligatoire : le titre annonce un TEMPS DE JEU LIBRE entre enfants de 3 à 5 ans (« Je joue avec mes amis », « Je partage mes jouets », « Je joue aux jeux de construction »…). Toute la fiche porte sur ce jeu libre et sur les habiletés sociales (partager, attendre son tour, aider, ranger) : une petite scène où un enfant (prénom béninois) ne sait pas à quoi jouer ou ne partage pas (ms) → les enfants disent ce qu'ils ont vu et à quoi ils aiment jouer (acq) → a1 DÉCOUVERTE DU MATÉRIEL ET DES RÈGLES (observer le matériel, choisir une activité, dire les règles de vie : partager, ranger, ne pas se disputer) → a2 JEU LIBRE (les enfants jouent entre eux ; l'adulte observe, encourage et aide si besoin). Il n'y a PAS d'activité N°3.`,
  spec: {
    ms: `\"ms\" — MISE EN SITUATION. Une petite scène racontée (1 à 2 phrases) liée au titre : un camarade (prénom béninois) ne partage pas ou ne sait pas à quoi jouer. r : « L'enfant a écouté. »`,
    acq: `\"acq\" — PRISE EN COMPTE DES ACQUIS ANTÉRIEURS. 3 questions : « • Dis ce que tu as entendu. » « • À quoi aimes-tu jouer ? » « • Que fais-tu avec tes amis ? » r : « A dit ce qu'il a entendu. » « Réponses diverses. » « Réponses diverses. »`,
    ann: `\"ann\" — ANNONCE DE L'APPRENTISSAGE DU JOUR. Deux lignes : « • Aujourd'hui, tu vas jouer librement avec le matériel proposé. » puis « • Dis ce que tu vas faire aujourd'hui. » r : « A écouté. » puis « A dit : jouer avec ses amis. »`,
    a1: `\"a1\" — ACTIVITÉ N°1 : DÉCOUVERTE DU MATÉRIEL ET DES RÈGLES. « • Observe le matériel mis à ta disposition. » « • Choisis une activité. » « • Dis les règles à respecter pour jouer avec tes amis. » r : « A observé. » « A choisi. » « A dit les règles : partager, ranger, ne pas se disputer. »`,
    a2: `\"a2\" — ACTIVITÉ N°2 : JEU LIBRE. « • Joue avec tes camarades. (L'adulte observe, encourage et aide les enfants si nécessaire.) » « • Partage le matériel avec tes amis. » r : « A joué. » « A partagé. »`,
    eval: `\"eval\" — ÉVALUATION. Deux consignes : « • Dis ce que tu as fait. » « • Comment as-tu joué avec tes amis ? » r : « A dit ce qu'il a fait. » « A joué sans se disputer. »`,
    conn: `\"conn\" — CONNEXION. Deux lignes : « • Aimes-tu jouer avec tes amis ? » puis « • Et maintenant ? » r : « Oui. » puis « Réponses diverses. »`
  },
  example: `Modèle de FORME (leçon « Je joue avec mes amis », ne pas recopier) :
ms.c : « • Koffi arrive en récréation. Il reste seul dans son coin et ne veut pas partager ses jouets. » ms.r : « L'enfant a écouté. »
acq.c : « • Dis ce que tu as entendu.\\n• À quoi aimes-tu jouer ?\\n• Que fais-tu avec tes amis ? » acq.r : « A dit ce qu'il a entendu.\\nRéponses diverses.\\nRéponses diverses. »
ann.c : « • Aujourd'hui, tu vas jouer librement avec le matériel proposé.\\n• Dis ce que tu vas faire aujourd'hui. » ann.r : « A écouté.\\nA dit : jouer avec ses amis. »
a1.c : « • Observe le matériel mis à ta disposition.\\n• Choisis une activité.\\n• Dis les règles à respecter pour jouer avec tes amis. » a1.r : « A observé.\\nA choisi.\\nA dit les règles : partager, ranger, ne pas se disputer. »
a2.c : « • Joue avec tes camarades. (L'adulte observe, encourage et aide les enfants si nécessaire.)\\n• Partage le matériel avec tes amis. » a2.r : « A joué.\\nA partagé. »
eval.c : « • Dis ce que tu as fait.\\n• Comment as-tu joué avec tes amis ? » eval.r : « A dit ce qu'il a fait.\\nA joué sans se disputer. »
conn.c : « • Aimes-tu jouer avec tes amis ?\\n• Et maintenant ? » conn.r : « Oui.\\nRéponses diverses. »`
};
/* ---------- Maternelle — Domaine 1 : bien-être (santé et environnement) — éducation pour la santé systématique ----------
   Six routines (propositions du 25/10/2026) : Passage aux toilettes, Lavage des mains, Goûter, Accueil, Sieste, Activités de vie pratique.
   Trame courte, sans Activité N°3 : a1 = SAVOIR / OBSERVER (démonstration, questions), a2 = FAIRE (pratique guidée : l'adulte corrige, encourage, félicite). */
const D1_DOMAINE = "bien-être (santé et environnement) — éducation pour la santé systématique";
const D1_KEYS = ['ms', 'acq', 'ann', 'a1', 'a2', 'eval', 'conn'];
const D1_REGLES = ` Contexte : école maternelle du Bénin, enfants de 3 à 5 ans ; matériel simple et réaliste (seau d'eau avec robinet, gobelet, savon, serviette, natte, poubelle). Les prénoms des enfants sont béninois. Les consignes sont des gestes CONCRETS et OBSERVABLES, dans l'ordre exact où l'enfant les exécute ; chaque consigne a sa ligne de résultat attendu « r » (même nombre de lignes, dans le même ordre). Aucune consigne dangereuse (pas d'eau chaude, pas de produit ménager, pas de couteau). Aucun conseil médical.`;
MAT_MODELS.toilettes = {
  domaine: D1_DOMAINE + " — passage aux toilettes",
  keys: D1_KEYS,
  fil: `Fil conducteur obligatoire : le titre annonce une habitude liée au PASSAGE AUX TOILETTES (« Je vais aux toilettes quand j'en ai besoin », « Je suis propre après les toilettes »…). ms : une petite scène (1 à 2 phrases) où un enfant (prénom) se retient, fait dans la classe ou laisse les toilettes sales ; acq : les enfants disent ce qu'il a fait et ce qu'il devait faire ; a1 SAVOIR (où sont les toilettes, quand y aller, comment demander la permission, ce qu'on fait avant de sortir) ; a2 FAIRE (se mettre en file, utiliser les toilettes, verser de l'eau ou tirer la chasse, se laver les mains, revenir en classe en marchant).` + D1_REGLES,
  spec: {
    ms: `\"ms\" — MISE EN SITUATION. Une petite scène racontée par l'adulte (1 à 2 phrases) en lien exact avec le titre. r : « L'enfant a écouté. »`,
    acq: `\"acq\" — PRISE EN COMPTE DES ACQUIS ANTÉRIEURS. 3 questions : « • Dis ce que tu as entendu. » « • Qu'a fait [prénom] ? » « • Que devait-il (elle) faire ? » r : « A dit ce qu'il a entendu. » ce que l'enfant a fait (ex. « A fait dans la classe. ») ce qu'il devait faire (ex. « Aller aux toilettes. »).`,
    ann: MAT_COMMON_SPEC.ann,
    a1: `\"a1\" — ACTIVITÉ N°1 : SAVOIR. 4 à 5 consignes, une par ligne : « • Observe l'endroit où se trouvent les toilettes. » « • Dis quand il faut aller aux toilettes. » « • Dis comment tu demandes la permission à la maîtresse. (L'adulte montre le geste : lever le doigt et dire « Maîtresse, je vais aux toilettes. ») » « • Dis ce qu'il faut faire avant de sortir des toilettes. » r : une ligne par consigne (« A observé. », « A dit : quand j'en ai besoin. », « A levé le doigt. », « A dit : se laver les mains. »).`,
    a2: `\"a2\" — ACTIVITÉ N°2 : FAIRE. 5 à 6 consignes d'action à l'impératif, dans l'ordre : « • Mets-toi en file. » « • Entre dans les toilettes. » « • Utilise les toilettes. » « • Verse de l'eau (ou tire la chasse). » « • Lave-toi les mains avec du savon. » « • Reviens en classe en marchant. » puis EXACTEMENT ces trois dernières lignes : « • L'adulte accompagne et corrige les mauvais gestes. » « • Encourage les timides. » « • Félicite ceux qui ont réussi. » r : « Exécuté. » (une ligne par consigne d'action).`,
    eval: `\"eval\" — ÉVALUATION. UNE consigne : « • Montre comment tu vas aux toilettes. » r : « A montré les gestes. »`,
    conn: `\"conn\" — CONNEXION. Deux lignes : « • Vas-tu aux toilettes de la même façon à la maison ? » puis « • Et maintenant ? » r : « Réponses diverses. » puis « Oui. »`
  },
  example: `Modèle de FORME (leçon « Je vais aux toilettes quand j'en ai besoin », ne pas recopier) :
ms.c : « • Koffi se tortille sur sa chaise. Il n'ose rien dire à la maîtresse et il fait pipi dans sa culotte. » ms.r : « L'enfant a écouté. »
acq.c : « • Dis ce que tu as entendu.\\n• Qu'a fait Koffi ?\\n• Que devait-il faire ? » acq.r : « A dit ce qu'il a entendu.\\nA fait pipi dans sa culotte.\\nAller aux toilettes. »
ann.c : « • Aujourd'hui, tu vas apprendre à aller aux toilettes quand tu en as besoin.\\n• Dis ce que tu vas apprendre aujourd'hui. » ann.r : « Écoute.\\nA dit : aller aux toilettes quand j'en ai besoin. »
a1.c : « • Observe l'endroit où se trouvent les toilettes.\\n• Dis quand il faut aller aux toilettes.\\n• Dis comment tu demandes la permission à la maîtresse. (L'adulte montre le geste : lever le doigt et dire « Maîtresse, je vais aux toilettes. »)\\n• Dis ce qu'il faut faire avant de sortir des toilettes. » a1.r : « A observé.\\nA dit : dès que j'en ai besoin.\\nA levé le doigt et a demandé.\\nA dit : se laver les mains. »
a2.c : « • Mets-toi en file.\\n• Entre dans les toilettes.\\n• Utilise les toilettes.\\n• Verse de l'eau.\\n• Lave-toi les mains avec du savon.\\n• Reviens en classe en marchant.\\n• L'adulte accompagne et corrige les mauvais gestes.\\n• Encourage les timides.\\n• Félicite ceux qui ont réussi. » a2.r : « Exécuté.\\nExécuté.\\nExécuté.\\nExécuté.\\nExécuté.\\nExécuté. »
eval.c : « • Montre comment tu vas aux toilettes. » eval.r : « A montré les gestes. »
conn.c : « • Vas-tu aux toilettes de la même façon à la maison ?\\n• Et maintenant ? » conn.r : « Réponses diverses.\\nOui. »`
};
MAT_MODELS.lavage = {
  domaine: D1_DOMAINE + " — lavage des mains",
  keys: D1_KEYS,
  fil: `Fil conducteur obligatoire : le titre annonce le LAVAGE DES MAINS (« Je me lave les mains avant de manger », « Je me lave les mains après les toilettes »…). ms : une petite scène (1 à 2 phrases) où un enfant (prénom) mange ou joue avec les mains sales ; acq : les enfants disent ce qu'il a fait et ce qu'il devait faire ; a1 SAVOIR/OBSERVER (l'adulte lave ses mains devant les enfants, étape par étape : mouiller, savonner, frotter paumes, dos des mains, entre les doigts et ongles, rincer, essuyer ; les enfants disent ce qu'ils ont vu et QUAND il faut se laver les mains) ; a2 FAIRE (chaque enfant se lave les mains en chantant un petit chant du lavage des mains, puis dit les étapes dans l'ordre).` + D1_REGLES,
  spec: {
    ms: `\"ms\" — MISE EN SITUATION. Une petite scène racontée par l'adulte (1 à 2 phrases) en lien exact avec le titre. r : « L'enfant a écouté. »`,
    acq: `\"acq\" — PRISE EN COMPTE DES ACQUIS ANTÉRIEURS. 3 questions : « • Dis ce que tu as entendu. » « • Qu'a fait [prénom] avec ses mains ? » « • Que devait-il (elle) faire avant ? » r : « A dit ce qu'il a entendu. » ce qu'il a fait (ex. « A mangé avec les mains sales. ») ce qu'il devait faire (« Se laver les mains. »).`,
    ann: MAT_COMMON_SPEC.ann,
    a1: `\"a1\" — ACTIVITÉ N°1 : OBSERVER ET DIRE. « • Observe la maîtresse. (L'adulte lave ses mains devant les enfants, étape par étape : mouiller, savonner, frotter les paumes, le dos des mains, entre les doigts et les ongles, rincer, essuyer.) » « • Dis ce que la maîtresse a fait en premier. » « • Dis ce qu'elle a fait ensuite. » « • Dis quand il faut se laver les mains. » r : « A observé. » « A dit : mouiller les mains. » « A dit : mettre du savon et frotter. » « A dit : avant de manger, après les toilettes, après le jeu. »`,
    a2: `\"a2\" — ACTIVITÉ N°2 : FAIRE. 5 à 6 consignes à l'impératif, dans l'ordre : « • Mouille tes mains. » « • Mets du savon. » « • Frotte les paumes, le dos des mains, entre les doigts et les ongles en chantant le chant du lavage des mains. » « • Rince tes mains. » « • Essuie-les avec la serviette. » « • Dis dans l'ordre ce que tu as fait. » puis EXACTEMENT ces trois dernières lignes : « • L'adulte corrige les mauvais gestes. » « • Encourage les timides. » « • Félicite ceux qui ont réussi. » r : « Exécuté. » (une ligne par consigne d'action).`,
    eval: `\"eval\" — ÉVALUATION. UNE consigne : « • Montre les étapes du lavage des mains dans l'ordre. » r : « A montré les étapes dans l'ordre. »`,
    conn: `\"conn\" — CONNEXION. Deux lignes : « • Te laves-tu les mains à la maison avant de manger ? » puis « • Et maintenant ? » r : « Réponses diverses. » puis « Oui. »`
  },
  example: `Modèle de FORME (leçon « Je me lave les mains avant de manger », ne pas recopier) :
ms.c : « • Afi prend son goûter sans se laver les mains après avoir joué dans le sable. » ms.r : « L'enfant a écouté. »
acq.c : « • Dis ce que tu as entendu.\\n• Qu'a fait Afi avec ses mains ?\\n• Que devait-elle faire avant de manger ? » acq.r : « A dit ce qu'il a entendu.\\nElle a mangé avec les mains sales.\\nSe laver les mains. »
ann.c : « • Aujourd'hui, tu vas apprendre à te laver les mains avant de manger.\\n• Dis ce que tu vas apprendre aujourd'hui. » ann.r : « Écoute.\\nA dit : me laver les mains avant de manger. »
a1.c : « • Observe la maîtresse. (L'adulte lave ses mains devant les enfants, étape par étape : mouiller, savonner, frotter les paumes, le dos des mains, entre les doigts et les ongles, rincer, essuyer.)\\n• Dis ce que la maîtresse a fait en premier.\\n• Dis ce qu'elle a fait ensuite.\\n• Dis quand il faut se laver les mains. » a1.r : « A observé.\\nA dit : mouiller les mains.\\nA dit : mettre du savon et frotter.\\nA dit : avant de manger, après les toilettes, après le jeu. »
a2.c : « • Mouille tes mains.\\n• Mets du savon.\\n• Frotte les paumes, le dos des mains, entre les doigts et les ongles en chantant le chant du lavage des mains.\\n• Rince tes mains.\\n• Essuie-les avec la serviette.\\n• Dis dans l'ordre ce que tu as fait.\\n• L'adulte corrige les mauvais gestes.\\n• Encourage les timides.\\n• Félicite ceux qui ont réussi. » a2.r : « Exécuté.\\nExécuté.\\nExécuté.\\nExécuté.\\nExécuté.\\nExécuté. »
eval.c : « • Montre les étapes du lavage des mains dans l'ordre. » eval.r : « A montré les étapes dans l'ordre. »
conn.c : « • Te laves-tu les mains à la maison avant de manger ?\\n• Et maintenant ? » conn.r : « Réponses diverses.\\nOui. »`
};
MAT_MODELS.gouter = {
  domaine: D1_DOMAINE + " — goûter",
  keys: D1_KEYS,
  fil: `Fil conducteur obligatoire : le titre annonce une habitude liée au GOÛTER (« Je mange proprement mon goûter », « Je partage mon goûter avec mes amis »…). ms : une petite scène (1 à 2 phrases) où un enfant (prénom) mange salement, jette ses restes par terre ou ne partage pas ; acq : les enfants disent ce qu'il a fait et ce qu'il devait faire ; a1 SAVOIR (avant le goûter : se laver les mains, s'asseoir, prendre sa boîte ; les bonnes manières : attendre, dire merci, ne pas parler la bouche pleine) ; a2 FAIRE (manger proprement, partager avec un ami, jeter les déchets à la poubelle, se laver les mains et ranger sa boîte).` + D1_REGLES,
  spec: {
    ms: `\"ms\" — MISE EN SITUATION. Une petite scène racontée par l'adulte (1 à 2 phrases) en lien exact avec le titre. r : « L'enfant a écouté. »`,
    acq: `\"acq\" — PRISE EN COMPTE DES ACQUIS ANTÉRIEURS. 3 questions : « • Dis ce que tu as entendu. » « • Qu'a fait [prénom] pendant le goûter ? » « • Que devait-il (elle) faire ? » r : « A dit ce qu'il a entendu. » ce qu'il a fait (ex. « A jeté ses restes par terre. ») ce qu'il devait faire (ex. « Les mettre à la poubelle. »).`,
    ann: MAT_COMMON_SPEC.ann,
    a1: `\"a1\" — ACTIVITÉ N°1 : SAVOIR. 4 à 5 consignes : « • Dis ce que tu fais avant de manger. » « • Dis comment tu t'assois pour manger. » « • Dis ce que tu dis quand on te donne quelque chose. » « • Dis ce qu'il ne faut pas faire en mangeant. » r : « A dit : me laver les mains. » « A dit : m'asseoir bien droit. » « A dit : merci. » « A dit : ne pas parler la bouche pleine, ne pas jouer avec la nourriture. »`,
    a2: `\"a2\" — ACTIVITÉ N°2 : FAIRE. 5 à 6 consignes d'action à l'impératif, dans l'ordre : « • Lave-toi les mains. » « • Assieds-toi et prends ta boîte. » « • Mange proprement. » « • Partage ton goûter avec ton ami. » « • Jette les déchets à la poubelle. » « • Range ta boîte. » puis EXACTEMENT ces trois dernières lignes : « • L'adulte corrige les mauvais gestes. » « • Encourage les timides. » « • Félicite ceux qui ont réussi. » r : « Exécuté. » (une ligne par consigne d'action).`,
    eval: `\"eval\" — ÉVALUATION. UNE consigne : « • Dis ce qu'on fait avant, pendant et après le goûter. » r : « A dit : se laver les mains, manger proprement, jeter les déchets. »`,
    conn: `\"conn\" — CONNEXION. Deux lignes : « • Manges-tu proprement à la maison ? » puis « • Et maintenant ? » r : « Réponses diverses. » puis « Oui. »`
  },
  example: `Modèle de FORME (leçon « Je mange proprement mon goûter », ne pas recopier) :
ms.c : « • Séna mange son goûter en jouant avec la nourriture. Elle laisse tomber des miettes et jette son emballage par terre. » ms.r : « L'enfant a écouté. »
acq.c : « • Dis ce que tu as entendu.\\n• Qu'a fait Séna pendant le goûter ?\\n• Que devait-elle faire ? » acq.r : « A dit ce qu'il a entendu.\\nA jeté son emballage par terre.\\nLe mettre à la poubelle. »
ann.c : « • Aujourd'hui, tu vas apprendre à manger proprement ton goûter.\\n• Dis ce que tu vas apprendre aujourd'hui. » ann.r : « Écoute.\\nA dit : manger proprement mon goûter. »
a1.c : « • Dis ce que tu fais avant de manger.\\n• Dis comment tu t'assois pour manger.\\n• Dis ce que tu dis quand on te donne quelque chose.\\n• Dis ce qu'il ne faut pas faire en mangeant. » a1.r : « A dit : me laver les mains.\\nA dit : m'asseoir bien droit.\\nA dit : merci.\\nA dit : ne pas parler la bouche pleine. »
a2.c : « • Lave-toi les mains.\\n• Assieds-toi et prends ta boîte.\\n• Mange proprement.\\n• Partage ton goûter avec ton ami.\\n• Jette les déchets à la poubelle.\\n• Range ta boîte.\\n• L'adulte corrige les mauvais gestes.\\n• Encourage les timides.\\n• Félicite ceux qui ont réussi. » a2.r : « Exécuté.\\nExécuté.\\nExécuté.\\nExécuté.\\nExécuté.\\nExécuté. »
eval.c : « • Dis ce qu'on fait avant, pendant et après le goûter. » eval.r : « A dit : se laver les mains, manger proprement, jeter les déchets. »
conn.c : « • Manges-tu proprement à la maison ?\\n• Et maintenant ? » conn.r : « Réponses diverses.\\nOui. »`
};
MAT_MODELS.accueil = {
  domaine: D1_DOMAINE + " — accueil",
  keys: D1_KEYS,
  fil: `Fil conducteur obligatoire : le titre annonce un moment d'ACCUEIL du matin (« Je salue ma maîtresse et mes amis », « Je range mes affaires en arrivant »…). ms : une petite scène (1 à 2 phrases) où un enfant (prénom) arrive en classe sans saluer ou jette son sac par terre ; acq : les enfants disent ce qu'il a fait et ce qu'il devait faire ; a1 SAVOIR/FAIRE L'ARRIVÉE (saluer la maîtresse et les amis, dire son prénom, ranger son sac et ses affaires à sa place) ; a2 RITUELS DU MATIN (chant de bienvenue, appel, dire quel jour on est et le temps qu'il fait).` + D1_REGLES,
  spec: {
    ms: `\"ms\" — MISE EN SITUATION. Une petite scène racontée par l'adulte (1 à 2 phrases) en lien exact avec le titre. r : « L'enfant a écouté. »`,
    acq: `\"acq\" — PRISE EN COMPTE DES ACQUIS ANTÉRIEURS. 3 questions : « • Dis ce que tu as entendu. » « • Qu'a fait [prénom] en arrivant ? » « • Que devait-il (elle) faire ? » r : « A dit ce qu'il a entendu. » ce qu'il a fait (ex. « Il n'a pas salué. ») ce qu'il devait faire (ex. « Saluer la maîtresse. »).`,
    ann: MAT_COMMON_SPEC.ann,
    a1: `\"a1\" — ACTIVITÉ N°1 : L'ARRIVÉE. 4 à 5 consignes d'action : « • Salue la maîtresse. » « • Salue tes amis. » « • Dis ton prénom. » « • Range ton sac à sa place. » « • Va t'asseoir à ta place. » r : « Exécuté. » ou ce que l'enfant dit (« A dit : bonjour maîtresse. »), une ligne par consigne. Dans la première consigne, ajoute entre parenthèses ce que fait l'adulte (« L'adulte accueille chaque enfant à la porte et répond à son salut. »).`,
    a2: `\"a2\" — ACTIVITÉ N°2 : LES RITUELS DU MATIN. 4 à 5 consignes : « • Chante le chant de bienvenue avec tes amis. » « • Réponds quand la maîtresse t'appelle. » « • Dis quel jour nous sommes. » « • Dis quel temps il fait. » puis EXACTEMENT ces trois dernières lignes : « • L'adulte corrige. » « • Encourage les timides. » « • Félicite ceux qui ont réussi. » r : « A chanté. » « A répondu. » « A dit le jour. » « A dit le temps. »`,
    eval: `\"eval\" — ÉVALUATION. UNE consigne : « • Dis ce que tu fais quand tu arrives à l'école. » r : « A dit : saluer, ranger son sac, s'asseoir. »`,
    conn: `\"conn\" — CONNEXION. Deux lignes : « • Salues-tu aussi tes voisins le matin ? » puis « • Et maintenant ? » r : « Réponses diverses. » puis « Oui. »`
  },
  example: `Modèle de FORME (leçon « Je salue ma maîtresse et mes amis », ne pas recopier) :
ms.c : « • Kofi arrive en classe, jette son sac par terre et s'assoit sans dire bonjour à personne. » ms.r : « L'enfant a écouté. »
acq.c : « • Dis ce que tu as entendu.\\n• Qu'a fait Kofi en arrivant ?\\n• Que devait-il faire ? » acq.r : « A dit ce qu'il a entendu.\\nIl n'a pas salué et a jeté son sac.\\nSaluer et ranger son sac. »
ann.c : « • Aujourd'hui, tu vas apprendre à saluer ta maîtresse et tes amis.\\n• Dis ce que tu vas apprendre aujourd'hui. » ann.r : « Écoute.\\nA dit : saluer ma maîtresse et mes amis. »
a1.c : « • Salue la maîtresse. (L'adulte accueille chaque enfant à la porte et répond à son salut.)\\n• Salue tes amis.\\n• Dis ton prénom.\\n• Range ton sac à sa place.\\n• Va t'asseoir à ta place. » a1.r : « A dit : bonjour maîtresse.\\nA dit : bonjour.\\nA dit son prénom.\\nExécuté.\\nExécuté. »
a2.c : « • Chante le chant de bienvenue avec tes amis.\\n• Réponds quand la maîtresse t'appelle.\\n• Dis quel jour nous sommes.\\n• Dis quel temps il fait.\\n• L'adulte corrige.\\n• Encourage les timides.\\n• Félicite ceux qui ont réussi. » a2.r : « A chanté.\\nA répondu.\\nA dit le jour.\\nA dit le temps. »
eval.c : « • Dis ce que tu fais quand tu arrives à l'école. » eval.r : « A dit : saluer, ranger son sac, s'asseoir. »
conn.c : « • Salues-tu aussi tes voisins le matin ?\\n• Et maintenant ? » conn.r : « Réponses diverses.\\nOui. »`
};
MAT_MODELS.sieste = {
  domaine: D1_DOMAINE + " — sieste",
  keys: D1_KEYS,
  fil: `Fil conducteur obligatoire : le titre annonce le temps de SIESTE (« Je me prépare pour la sieste », « Je me repose calmement »…). ms : une petite scène (1 à 2 phrases) où un enfant (prénom) s'agite, parle ou réveille ses camarades pendant la sieste ; acq : les enfants disent ce qu'il a fait et ce qu'il devait faire ; a1 SAVOIR/SE PRÉPARER (pourquoi on se repose, se déchausser, prendre sa natte, se placer en silence) ; a2 FAIRE (s'allonger, fermer les yeux, rester calme avec la berceuse, puis au réveil se lever, plier sa natte, remettre ses chaussures).` + D1_REGLES,
  spec: {
    ms: `\"ms\" — MISE EN SITUATION. Une petite scène racontée par l'adulte (1 à 2 phrases) en lien exact avec le titre. r : « L'enfant a écouté. »`,
    acq: `\"acq\" — PRISE EN COMPTE DES ACQUIS ANTÉRIEURS. 3 questions : « • Dis ce que tu as entendu. » « • Qu'a fait [prénom] pendant la sieste ? » « • Que devait-il (elle) faire ? » r : « A dit ce qu'il a entendu. » ce qu'il a fait (ex. « Il a parlé et réveillé ses amis. ») ce qu'il devait faire (ex. « Rester calme. »).`,
    ann: MAT_COMMON_SPEC.ann,
    a1: `\"a1\" — ACTIVITÉ N°1 : SE PRÉPARER. 4 à 5 consignes : « • Dis pourquoi on se repose après les activités. » « • Déchausse-toi et range tes chaussures. » « • Prends ta natte. » « • Place-toi sur ta natte sans bruit. » r : « A dit : pour reprendre des forces. » « Exécuté. » « Exécuté. » « Exécuté. »`,
    a2: `\"a2\" — ACTIVITÉ N°2 : SE REPOSER. 4 à 5 consignes à l'impératif, dans l'ordre : « • Allonge-toi sur ta natte. » « • Ferme les yeux et reste calme. (L'adulte chante une berceuse à voix basse.) » « • Au réveil, lève-toi doucement. » « • Plie ta natte et remets tes chaussures. » puis EXACTEMENT ces trois dernières lignes : « • L'adulte veille sur les enfants et aide les réveillés. » « • Encourage les timides. » « • Félicite ceux qui sont restés calmes. » r : « S'est allongé. » « S'est reposé. » « Exécuté. » « Exécuté. »`,
    eval: `\"eval\" — ÉVALUATION. UNE consigne : « • Montre comment tu te prépares pour la sieste. » r : « A montré les gestes. »`,
    conn: `\"conn\" — CONNEXION. Deux lignes : « • Te reposes-tu à la maison l'après-midi ? » puis « • Et maintenant ? » r : « Réponses diverses. » puis « Oui. »`
  },
  example: `Modèle de FORME (leçon « Je me prépare pour la sieste », ne pas recopier) :
ms.c : « • Pendant la sieste, Yao parle à voix haute et tire la natte de son voisin. Les autres enfants ne peuvent pas dormir. » ms.r : « L'enfant a écouté. »
acq.c : « • Dis ce que tu as entendu.\\n• Qu'a fait Yao pendant la sieste ?\\n• Que devait-il faire ? » acq.r : « A dit ce qu'il a entendu.\\nIl a parlé et dérangé ses amis.\\nRester calme et se reposer. »
ann.c : « • Aujourd'hui, tu vas apprendre à te préparer pour la sieste.\\n• Dis ce que tu vas apprendre aujourd'hui. » ann.r : « Écoute.\\nA dit : me préparer pour la sieste. »
a1.c : « • Dis pourquoi on se repose après les activités.\\n• Déchausse-toi et range tes chaussures.\\n• Prends ta natte.\\n• Place-toi sur ta natte sans bruit. » a1.r : « A dit : pour reprendre des forces.\\nExécuté.\\nExécuté.\\nExécuté. »
a2.c : « • Allonge-toi sur ta natte.\\n• Ferme les yeux et reste calme. (L'adulte chante une berceuse à voix basse.)\\n• Au réveil, lève-toi doucement.\\n• Plie ta natte et remets tes chaussures.\\n• L'adulte veille sur les enfants et aide les réveillés.\\n• Encourage les timides.\\n• Félicite ceux qui sont restés calmes. » a2.r : « S'est allongé.\\nS'est reposé.\\nExécuté.\\nExécuté. »
eval.c : « • Montre comment tu te prépares pour la sieste. » eval.r : « A montré les gestes. »
conn.c : « • Te reposes-tu à la maison l'après-midi ?\\n• Et maintenant ? » conn.r : « Réponses diverses.\\nOui. »`
};
MAT_MODELS.viePratique = {
  domaine: D1_DOMAINE + " — activités de vie pratique",
  keys: D1_KEYS,
  fil: `Fil conducteur obligatoire : le titre annonce UNE activité de VIE PRATIQUE précise (« Je verse l'eau sans la renverser », « Je transvase des graines », « Je boutonne ma chemise », « Je balaie la classe »…). Toute la fiche porte sur ce seul geste : ms : une petite scène (1 à 2 phrases) où un enfant (prénom) a une difficulté avec ce geste (il renverse, il n'y arrive pas, il laisse du désordre) ; acq : les enfants disent ce qu'il a fait et ce qu'il devait faire ; a1 OBSERVER ET DIRE (l'adulte montre le geste lentement, en décomposant les étapes du titre ; les enfants disent ce qu'ils ont vu et nomment le matériel) ; a2 FAIRE (chaque enfant refait le geste avec le matériel, étape par étape ; l'adulte corrige, encourage, félicite). Le matériel est du matériel de récupération sans danger (gobelets, bassines, graines, perles, cuillères, balayette, linge).` + D1_REGLES,
  spec: {
    ms: `\"ms\" — MISE EN SITUATION. Une petite scène racontée par l'adulte (1 à 2 phrases) en lien exact avec le geste du titre. r : « L'enfant a écouté. »`,
    acq: `\"acq\" — PRISE EN COMPTE DES ACQUIS ANTÉRIEURS. 3 questions : « • Dis ce que tu as entendu. » « • Qu'a fait [prénom] ? » « • Que devait-il (elle) faire ? » r : « A dit ce qu'il a entendu. » ce qu'il a fait (ex. « A renversé l'eau. ») ce qu'il devait faire (ex. « Verser doucement. »).`,
    ann: MAT_COMMON_SPEC.ann,
    a1: `\"a1\" — ACTIVITÉ N°1 : OBSERVER ET DIRE. « • Observe la maîtresse. (L'adulte réalise le geste du titre lentement, en décomposant les étapes.) » « • Nomme le matériel utilisé. » « • Dis ce que la maîtresse a fait en premier. » « • Dis ce qu'elle a fait ensuite. » r : « A observé. » « A nommé : [matériel réel]. » « A dit la première étape. » « A dit l'étape suivante. »`,
    a2: `\"a2\" — ACTIVITÉ N°2 : FAIRE. 4 à 5 consignes d'action à l'impératif, étape par étape, propres au geste du titre (ex. pour verser : « • Prends le gobelet avec une main. » « • Tiens la bassine avec l'autre main. » « • Verse doucement l'eau. » « • Essuie si tu renverses. »), puis EXACTEMENT ces trois dernières lignes : « • L'adulte corrige les mauvais gestes. » « • Encourage les timides. » « • Félicite ceux qui ont réussi. » r : « Exécuté. » (une ligne par consigne d'action).`,
    eval: `\"eval\" — ÉVALUATION. UNE consigne : « • Montre-moi comment tu [geste du titre]. » r : « A montré les gestes. »`,
    conn: `\"conn\" — CONNEXION. Deux lignes : « • Fais-tu aussi ce geste à la maison pour aider ta maman ? » puis « • Et maintenant ? » r : « Réponses diverses. » puis « Oui. »`
  },
  example: `Modèle de FORME (leçon « Je verse l'eau sans la renverser », ne pas recopier) :
ms.c : « • Ama veut verser de l'eau dans un gobelet. Elle verse trop vite et l'eau coule sur la table. » ms.r : « L'enfant a écouté. »
acq.c : « • Dis ce que tu as entendu.\\n• Qu'a fait Ama ?\\n• Que devait-elle faire ? » acq.r : « A dit ce qu'il a entendu.\\nElle a renversé l'eau.\\nVerser doucement. »
ann.c : « • Aujourd'hui, tu vas apprendre à verser l'eau sans la renverser.\\n• Dis ce que tu vas apprendre aujourd'hui. » ann.r : « Écoute.\\nA dit : verser l'eau sans la renverser. »
a1.c : « • Observe la maîtresse. (L'adulte verse l'eau lentement d'une cruche dans un gobelet, en décomposant les étapes.)\\n• Nomme le matériel utilisé.\\n• Dis ce que la maîtresse a fait en premier.\\n• Dis ce qu'elle a fait ensuite. » a1.r : « A observé.\\nA nommé : la cruche, le gobelet, le chiffon.\\nA dit : elle a pris la cruche.\\nA dit : elle a versé doucement. »
a2.c : « • Prends la cruche avec une main.\\n• Tiens le gobelet avec l'autre main.\\n• Verse doucement l'eau dans le gobelet.\\n• Essuie si tu renverses.\\n• L'adulte corrige les mauvais gestes.\\n• Encourage les timides.\\n• Félicite ceux qui ont réussi. » a2.r : « Exécuté.\\nExécuté.\\nExécuté.\\nExécuté. »
eval.c : « • Montre-moi comment tu verses l'eau sans la renverser. » eval.r : « A montré les gestes. »
conn.c : « • Fais-tu aussi ce geste à la maison pour aider ta maman ?\\n• Et maintenant ? » conn.r : « Réponses diverses.\\nOui. »`
};
function c0(b) { return String(b.composante || ''); }
function matModelOf(b) {
  if (b.domaine === 'domaine2') return MAT_MODELS.mouvement;
  if (b.domaine === 'domaine1') {
    const c1 = c0(b);
    if (/toilette/i.test(c1)) return MAT_MODELS.toilettes;
    if (/lavage|main/i.test(c1)) return MAT_MODELS.lavage;
    if (/go[uû]ter/i.test(c1)) return MAT_MODELS.gouter;
    if (/accueil/i.test(c1)) return MAT_MODELS.accueil;
    if (/sieste/i.test(c1)) return MAT_MODELS.sieste;
    return MAT_MODELS.viePratique;
  }
  if (b.domaine === 'domaine5') {
    if (/conte/i.test(c0(b))) return MAT_MODELS.conte;
    if (/communic/i.test(c0(b))) return MAT_MODELS.commOrale;
    if (/comptine/i.test(c0(b))) return MAT_MODELS.comptine;
    if (/chant/i.test(c0(b))) return MAT_MODELS.chant;
    if (/libre/i.test(c0(b))) return MAT_MODELS.libres;
    return MAT_MODELS.poesie;
  }
  if (b.domaine === 'domaine4') return /plastique/i.test(String(b.composante || '')) ? MAT_MODELS.plastique : MAT_MODELS.emotionnelle;
  const c = String(b.composante || '');
  if (/lecture/i.test(c)) return MAT_MODELS.lecture;
  if (/sensori/i.test(c)) return MAT_MODELS.sensorielle;
  if (/math/i.test(c)) return MAT_MODELS.mathematique;
  if (/observ/i.test(c)) return MAT_MODELS.observation;
  if (/manuel|travaux/i.test(c)) return MAT_MODELS.manuels;
  return MAT_MODELS.ecriture;
}
function buildMaternellePrompt(b, only, known) {
  const model = matModelOf(b);
  const h = b.header || {};
  const wanted = (only && only.length ? only : model.keys).filter(k => model.keys.includes(k));
  const wantMat = b.needMateriel && (!only || only.includes('materiel'));
  const ctx = [
    h.theme ? `Thème : ${h.theme}` : '',
    h.capacite ? `Capacité visée : ${h.capacite}` : '',
    h.habiletes ? `Habiletés : ${h.habiletes}` : '',
    h.competences ? `Compétence : ${h.competences}` : '',
    h.materiel ? `Matériel prévu par l'enseignant : ${h.materiel}` : ''
  ].filter(Boolean).join('\n');
  const knownBloc = known && Object.keys(known).length
    ? `\nParties DÉJÀ rédigées de cette leçon (reste strictement cohérent avec elles) :\n${Object.keys(known).map(k => `- ${MAT_LABELS[k]} : ${known[k].c}`).join('\n')}\n`
    : '';
  return `Tu aides une enseignante d'école maternelle au Bénin à rédiger une fiche de préparation.

Domaine : ${model.domaine || 'développement de la réflexion, des aptitudes cognitives et intellectuelles'}
Composante : ${b.composante || b.matiere || '(non précisée)'} (adapte le vocabulaire et les gestes à cette composante)
Section : ${b.classe || 'maternelle'}
Titre de l'activité : "${b.titre}"
${ctx}
${knownBloc}
La fiche suit une démarche en 3 temps : Introduction (mise en situation → prise en compte des acquis antérieurs → annonce), Réalisation (activités), Retour et projection. ${model.fil} Tout reste centré sur le titre « ${b.titre} ».

${model.example}

Règles :
- Français très simple, tutoiement, phrases courtes, adaptées à des enfants de 3 à 5 ans (section ${b.classe || 'maternelle'}).
${model.hasDosage ? `- Une consigne par ligne, chaque ligne commence par « - » (sauf « ms » et « jeux » : une phrase simple).
- PRÉCISION : nomme toujours le lieu, l'objet ou le geste réels du titre ; une consigne = une seule action motrice de l'enfant, claire et réalisable dans une cour d'école ; verbes d'action concrets (observe, évolue, place-toi, déplace-toi, saute, marche, montre…).
- FORMATION ET DOSAGE : « r » = la formation des enfants pour cette étape (« En demi-cercle », « En file indienne », « En cercle », « En ligne »…), « d » = le dosage, c'est-à-dire le nombre de répétitions (« 1 fois », « 2 ou 3 fois »…). Mets « r » et « d » à vide si l'étape n'en a pas besoin.
` : `- Une consigne par ligne, chaque ligne commence par « • » (sauf dans les résultats attendus « r », en phrases simples, une idée par ligne).
- PRÉCISION : nomme toujours l'objet, la notion ou le geste réels du titre (jamais « la notion », « le matériel » seul quand tu peux dire lequel) ; une consigne = une seule action de l'enfant, claire et réalisable en classe ; verbes d'action concrets (observe, nomme, montre, prends, touche, range…).
- ALIGNEMENT : dans « r », donne autant de lignes que de consignes qui appellent une réponse ou une action, dans le MÊME ordre que dans « c » (« Observe. » ↔ « • Observe… »), avec la réponse attendue réelle (pas « A répondu »).
`}- Reste BREF. N'invente aucun matériel absurde : utilise le matériel prévu s'il est donné, sinon le matériel le plus courant d'une classe maternelle.
- Varie les tournures et les prénoms d'une fiche à l'autre (graine de variation : ${b.seed || 'aucune'}), sans changer le sens ni l'ordre de la démarche.

Rédige UNIQUEMENT les parties suivantes :
${wanted.map(k => model.spec[k]).join('\n')}
${wantMat ? `"materiel" — liste courte (une ligne, séparée par des virgules) du matériel nécessaire à cette leçon.\n` : ''}
Réponds UNIQUEMENT avec un objet JSON strict, sans texte autour ni balises markdown :
{${wanted.map(k => model.hasDosage ? `"${k}":{"c":"…","r":"…","d":"…"}` : `"${k}":{"c":"…","r":"…"}`).join(',')}${wantMat ? ',"materiel":"…"' : ''}}
Dans les chaînes, sépare les lignes par \\n.`;
}
async function generateMaternelle(env, body) {
  const model = matModelOf(body);
  const out = {};
  let materiel = '';
  const known = {};
  for (let attempt = 0; attempt < 3; attempt++) {
    const missing = model.keys.filter(k => !out[k]);
    const wantMat = body.needMateriel && !materiel;
    if (attempt > 0 && !missing.length && !wantMat) break;
    const only = attempt === 0 ? null : (wantMat ? missing.concat(['materiel']) : missing);
    const result = await runAi(env, null, {
      prompt: buildMaternellePrompt(body, only, attempt === 0 ? null : known),
      max_tokens: 3500,
      temperature: attempt === 0 ? 0.75 : 0.5
    });
    const raw = ((result && result.response) || '').trim();
    const parsed = extractJson(raw) || salvagePairs(raw);
    if (!parsed) continue;
    model.keys.forEach(k => {
      const v = parsed[k];
      if (!v || out[k]) return;
      const isObj = typeof v === 'object' && !Array.isArray(v);
      const c = toText(isObj ? (v.c !== undefined ? v.c : v.consignes) : v);
      const r = isObj ? toText(v.r !== undefined ? v.r : (v.formation !== undefined ? v.formation : v.resultats)) : '';
      const d = isObj ? toText(v.d !== undefined ? v.d : v.dosage) : '';
      if (c) { out[k] = { c, r, d }; known[k] = out[k]; }
    });
    if (!materiel && parsed.materiel) materiel = toText(parsed.materiel);
    if (model.keys.every(k => out[k])) break;
  }
  return { sections: out, materiel };
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


    // Maternelle (Domaine 3) : génération cohérente de toute la fiche en une fois.
    if (body.mode === 'maternelle') {
      if (!titre) return json({ ok: false, reason: 'invalid-params' }, 400);
      const h = body.header && typeof body.header === 'object' ? body.header : {};
      const clip = v => String(v || '').trim().slice(0, 600);
      const { sections, materiel } = await generateMaternelle(env, {
        domaine: String(body.domaine || '').slice(0, 20),
        titre, classe, matiere, seed, composante: String(body.composante || '').slice(0, 60),
        header: { theme: clip(h.theme), capacite: clip(h.capacite), habiletes: clip(h.habiletes), competences: clip(h.competences), materiel: clip(h.materiel) },
        needMateriel: body.needMateriel === true
      });
      if (!Object.keys(sections).length) return json({ ok: false, reason: 'ai-empty' }, 502);
      return json({ ok: true, sections, materiel });
    }

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
