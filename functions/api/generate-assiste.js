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

// Demande au modèle les champs `items` et renvoie { label: texte } pour ceux effectivement rédigés.
async function generateOnce(env, matiere, classe, titre, demarche, items) {
  const prompt = buildPrompt(matiere, classe, titre, demarche, items);
  const result = await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
    prompt,
    max_tokens: 3000,
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
    if (Array.isArray(v)) {
      const joined = v.filter(x => typeof x === 'string' && x.trim()).join('\n').trim();
      if (joined) out[it.label] = joined;
    } else if (typeof v === 'string' && v.trim()) {
      out[it.label] = v.trim();
    }
  });
  return out;
}

function buildPrompt(matiere, classe, titre, demarche, items) {
  const champsListe = items
    .map((it, i) => `${i + 1}. "${it.label}" — ${it.consigne}`)
    .join('\n');

  return `Tu aides un(e) enseignant(e) du primaire au Bénin à rédiger une fiche pédagogique.

Matière : ${matiere}
Classe : ${classe || '(non précisée)'}
Titre de la séance : "${titre}"

Démarche pédagogique propre à cette matière (étapes de la séance, pour te situer) :
${demarche}

Rédige le contenu des champs suivants, en français, de façon concise et adaptée à des élèves de ${classe || 'primaire'}, en lien direct avec le titre de la séance ci-dessus. Chaque champ a sa propre consigne précise à respecter :
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

    if (!titre || !demarche || !items.length) {
      return json({ ok: false, reason: 'invalid-params' }, 400);
    }

    let outItems = await generateOnce(env, matiere, classe, titre, demarche, items);

    // Champs demandés absents de la réponse (ex. « Mise en situation » oubliée par le modèle) :
    // une seule relance ciblée sur ces champs.
    const missing = items.filter(it => !outItems || !outItems[it.label]);
    if (missing.length) {
      const retry = await generateOnce(env, matiere, classe, titre, demarche, missing);
      if (retry) outItems = Object.assign(outItems || {}, retry);
    }

    if (!outItems || !Object.keys(outItems).length) {
      return json({ ok: false, reason: 'ai-no-json' }, 502);
    }

    return json({ ok: true, items: outItems });
  } catch (err) {
    return json({ error: "Erreur lors de la génération assistée : " + err.message }, 500);
  }
}
