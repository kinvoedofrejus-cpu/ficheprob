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

// Demande au modèle les champs `items` et renvoie { label: texte } pour ceux effectivement rédigés.
async function generateOnce(env, matiere, classe, titre, demarche, items, resume) {
  const prompt = buildPrompt(matiere, classe, titre, demarche, items, resume);
  // Modèle réglable sans toucher au code : variable AI_MODEL (ex. @cf/meta/llama-3.3-70b-instruct-fp8-fast
  // pour des activités plus riches, au prix d'une consommation plus élevée du quota Workers AI).
  const model = env.AI_MODEL || '@cf/meta/llama-3.1-8b-instruct';
  const result = await env.AI.run(model, {
    prompt,
    max_tokens: 4096,
    temperature: 0.6
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

function buildPlainPrompt(matiere, classe, titre, demarche, item, resume, escalate) {
  return `Tu aides un(e) enseignant(e) du primaire au Bénin à rédiger une fiche pédagogique.

Matière : ${matiere}
Classe : ${classe || '(non précisée)'}
Titre de la séance : "${titre}"

Démarche pédagogique de la matière (suis-la : même sens, même ordre des étapes) :
${demarche}

${buildResumeBloc(resume)}Champ à rédiger : "${item.label}"
Consigne pour ce champ :
${item.consigne}

Exigences :
- Écris en français, au tutoiement, pour des élèves de ${classe || 'primaire'}.
- Reste dans le sens exact de la démarche : mêmes étapes, même ordre, rien d'étranger à la démarche.
- Sois DÉTAILLÉ et CONCRET : pour chaque étape, donne des consignes précises, les questions que le maître pose, des exemples, phrases, mots, nombres ou situations tirés de la leçon et du résumé, et la réponse attendue entre parenthèses.
- Une consigne par ligne, chacune commençant par « • ».
- Exemple de FORME uniquement (autre leçon, ne le recopie pas) :
  Texte de base : « • Lis les phrases du tableau.\\n• Dis ce que tu remarques. »
  Texte développé : « • Lis à haute voix les phrases écrites au tableau : « Le chat dort. » ; « Les enfants jouent. »\\n• Dis ce que ces phrases ont en commun (elles commencent par une majuscule et se terminent par un point).\\n• Souligne dans chaque phrase le mot qui dit qui fait l'action (le chat ; les enfants). »
${escalate ? "- ATTENTION : ta première réponse était trop proche du texte de base. Développe nettement plus : davantage de consignes, d'exemples concrets et de réponses attendues.\n" : ''}
Réponds UNIQUEMENT avec le texte final du champ : pas de titre, pas de JSON, pas de commentaire.`;
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

async function generatePlain(env, matiere, classe, titre, demarche, item, resume) {
  const model = env.AI_MODEL || '@cf/meta/llama-3.1-8b-instruct';
  const run = async (escalate) => {
    const result = await env.AI.run(model, {
      prompt: buildPlainPrompt(matiere, classe, titre, demarche, item, resume, escalate),
      max_tokens: 2500,
      temperature: escalate ? 0.75 : 0.6
    });
    return cleanPlain((result && result.response) || '', item.label);
  };
  let text = await run(false);
  const minLen = Number(item.minLen) || 0;
  if (!text || (minLen && text.length < minLen)) {
    const second = await run(true);
    if (second && second.length > (text || '').length) text = second;
  }
  return text;
}

function buildPrompt(matiere, classe, titre, demarche, items, resume) {
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

${resumeBloc}Rédige le contenu des champs suivants, en français, adapté à des élèves de ${classe || 'primaire'}, en lien direct avec le titre de la séance et avec le résumé de la leçon. Chaque champ a sa propre consigne précise à respecter, y compris pour sa longueur : court pour une question ou une mise en situation, DÉTAILLÉ (plusieurs consignes, avec questions, exemples tirés de la leçon et réponses attendues) pour les activités, l'objectivation, l'évaluation et les autres étapes de la démarche :
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

    if (!titre || !demarche || !items.length) {
      return json({ ok: false, reason: 'invalid-params' }, 400);
    }

    // Champ long à développer : réponse en texte brut, un champ par requête.
    if (body.plain === true && items.length === 1) {
      const text = await generatePlain(env, matiere, classe, titre, demarche, items[0], resume);
      if (!text) return json({ ok: false, reason: 'ai-empty' }, 502);
      return json({ ok: true, items: { [items[0].label]: text } });
    }

    let outItems = await generateOnce(env, matiere, classe, titre, demarche, items, resume);

    // Champs demandés absents de la réponse (ex. « Mise en situation » oubliée par le modèle) :
    // une seule relance ciblée sur ces champs.
    const missing = items.filter(it => !outItems || !outItems[it.label]);
    if (missing.length) {
      const retry = await generateOnce(env, matiere, classe, titre, demarche, missing, resume);
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
