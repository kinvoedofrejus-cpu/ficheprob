import { json } from './_shared.js';

// Cloudflare Function — /api/generate-epreuve
//
// Onglet « Épreuves » : génère une épreuve d'activité d'intégration (hors mathématiques, qui sont calculées
// directement dans le navigateur pour que le corrigé soit toujours exact).
//   requête  { type, classe, mois, resumes:[{titre,texte}], notions, seed }
//   type     'ee' (expression écrite) | 'lecture' | 'es' | 'est' | 'dessin'
//   réponse  { ok:true, epreuve:{ support:{titre,texte}, tache, items:[{intro,figure,questions[]}], consigne[], corrige[] } }
// Les modèles sont essayés dans l'ordre ; le suivant démarre si le précédent échoue ou tarde (STALL).
// Réglable : variables AI_EPREUVE_MODELS (liste séparée par des virgules), AI_STALL_MS.

const DEFAULT_MODELS = [
  '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
  '@cf/meta/llama-4-scout-17b-16e-instruct',
  '@cf/meta/llama-3.1-8b-instruct-fp8'
];
const MODEL_TIMEOUT_MS = 45000;
const DEFAULT_STALL_MS = 15000;

function models(env) {
  if (env.AI_EPREUVE_MODELS) {
    const l = String(env.AI_EPREUVE_MODELS).split(',').map(x => x.trim()).filter(Boolean);
    if (l.length) return l;
  }
  return DEFAULT_MODELS;
}

function aiText(result) {
  if (!result) return '';
  if (typeof result === 'string') return result;
  if (typeof result.response === 'string') return result.response;
  const c = result.choices && result.choices[0];
  if (c) return (c.message && c.message.content) || c.text || '';
  return '';
}

async function runChain(env, params, accept) {
  const list = models(env);
  const stallMs = (env.AI_STALL_MS !== undefined && env.AI_STALL_MS !== '' && !isNaN(Number(env.AI_STALL_MS))) ? Math.max(0, Number(env.AI_STALL_MS)) : DEFAULT_STALL_MS;
  const p = { messages: [{ role: 'user', content: params.prompt }], max_tokens: params.max_tokens, temperature: params.temperature };
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
        Promise.resolve().then(() => env.AI.run(model, p)),
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

// Extrait le premier objet JSON équilibré d'un texte (les modèles ajoutent parfois du texte ou des ```).
function extractJson(text) {
  const s = String(text || '').replace(/```json|```/gi, '');
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
    else if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { try { return JSON.parse(s.slice(start, i + 1)); } catch (e) { return null; } } }
  }
  return null;
}

const cleanStr = (v, max) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim().slice(0, max || 600);
const cleanArr = (a, max, n) => (Array.isArray(a) ? a : []).map(x => cleanStr(x, max)).filter(Boolean).slice(0, n || 12);

const FIGURES = ['serie', 'derivation', 'circuit', 'montages'];

// Réduit la réponse de l'IA à la forme attendue et refuse (null) ce qui est inutilisable.
function normalize(type, raw) {
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
    const qs = cleanArr(it && it.questions, 400, 6);
    if (!qs.length) continue;
    const fig = FIGURES.includes(it.figure) ? it.figure : '';
    out.items.push({ intro: cleanStr(it.intro, 700), figure: type === 'est' ? fig : '', questions: qs });
  }
  const rawCor = Array.isArray(raw.corrige) ? raw.corrige : [];
  out.corrige = rawCor.slice(0, 5).map(c => ({ item: cleanStr(c && c.item, 20), lignes: cleanArr(c && c.lignes, 500, 8) })).filter(c => c.lignes.length);

  if (!out.support.texte || !out.tache) return null;
  if (type === 'dessin') return out.consigne.length >= 2 ? out : null;
  if (type === 'ee') return out.items.length >= 1 && out.items[0].questions.length >= 2 ? (out.items = out.items.slice(0, 1), out) : null;
  if (out.items.length < 3) return null;
  out.items = out.items.slice(0, 3);
  if (type === 'lecture' && out.support.texte.length < 250) return null;
  return out;
}

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

function buildPrompt(type, classe, mois, resumes, notions, seed) {
  const T = TYPES[type];
  const doc = resumes.map((r, i) => `[${i + 1}] ${r.titre}\n${r.texte}`).join('\n\n');
  return `Tu es un(e) conseiller(ère) pédagogique du primaire au Bénin. Tu conçois une ÉPREUVE D'ACTIVITÉ D'INTÉGRATION (situation d'intégration, approche par les compétences) pour la classe de ${classe}, matière : ${T.label}, mois : ${mois}.

CONTENUS DÉJÀ ENSEIGNÉS (résumés de cours — l'épreuve ne doit porter QUE sur ces notions, pas sur d'autres) :
${doc || '(aucun résumé fourni)'}
${notions ? `\nNotions supplémentaires indiquées par l'enseignant : ${notions}\n` : ''}
FORME DE L'ÉPREUVE :
${T.forme}

RÈGLES :
- Contexte béninois, vie de l'élève (école, famille, village, marché, santé, environnement). Vocabulaire simple adapté au ${classe}, tutoiement dans les consignes.
- Une seule situation cohérente reliant toutes les questions ; les questions se répondent sur le papier, sans matériel.
- Chaque question doit pouvoir être corrigée avec certitude : pas de question ambiguë, aucun fait incertain.
- Ne recopie pas les résumés mot pour mot ; invente une situation nouvelle (variante n° ${seed}).
- « corrige » : les réponses attendues, courtes, une ligne par question (pour le dessin : les critères de réussite).

Réponds UNIQUEMENT par un objet JSON valide, sans texte avant ni après, sans bloc de code, exactement de cette forme :
${T.structure}`;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    if (!env.AI) return json({ ok: false, reason: 'ai-unavailable' }, 501);
    const body = await request.json();
    const type = String(body.type || '');
    if (!TYPES[type]) return json({ ok: false, reason: 'invalid-params' }, 400);
    const classe = cleanStr(body.classe, 20) || 'CM2';
    const mois = cleanStr(body.mois, 40) || '';
    const notions = cleanStr(body.notions, 400);
    const seed = Math.abs(parseInt(body.seed, 10) || Date.now() % 1000);
    const resumes = (Array.isArray(body.resumes) ? body.resumes : []).slice(0, 14).map(r => ({
      titre: cleanStr(r && r.titre, 140),
      texte: cleanStr(r && r.texte, 380)
    })).filter(r => r.titre);
    if (!resumes.length && !notions) return json({ ok: false, reason: 'no-content' }, 400);

    const epreuve = await runChain(env, {
      prompt: buildPrompt(type, classe, mois, resumes, notions, seed),
      max_tokens: 2600,
      temperature: 0.7
    }, text => normalize(type, extractJson(text)));
    return json({ ok: true, epreuve });
  } catch (err) {
    return json({ ok: false, reason: 'ai-busy', error: err.message }, 503);
  }
}
