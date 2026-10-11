import { json } from './_shared.js';

// Cloudflare Function — /api/generate-points
//
// Petit travail, IA très rapide : dans les « Activités de construction de nouveaux savoirs » (Mode Assisté),
// le titre annonce un fait de langue (fait grammatical, de conjugaison, d'orthographe). Cette fonction ne
// produit que 2 à 4 questions précises qui font sortir le ou les faits annoncés par le titre.
//   requête  { matiere, classe, titre, seed }
//   réponse  { ok:true, questions:["• Question ?", ...] }
// Modèles légers, essayés dans l'ordre (réglable : variable AI_FAST_MODELS, liste séparée par des virgules).
// Un échec n'est jamais bloquant : le front garde simplement le texte de la démarche tel quel.

const DEFAULT_FAST_MODELS = [
  '@cf/meta/llama-3.2-3b-instruct',
  '@cf/meta/llama-3.1-8b-instruct-fp8'
];
const FAST_TIMEOUT_MS = 7000;

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

async function runFast(env, params) {
  let lastErr = null;
  for (const model of fastModels(env)) {
    let timer;
    try {
      const result = await Promise.race([
        env.AI.run(model, params),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('délai dépassé')), FAST_TIMEOUT_MS); })
      ]);
      const text = aiText(result);
      if (text.trim()) return text;
    } catch (err) {
      lastErr = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr || new Error('IA indisponible');
}

function buildPrompt(matiere, classe, titre) {
  return `Tu aides un(e) enseignant(e) du primaire au Bénin à préparer une leçon.

Matière : ${matiere || 'Français'}
Classe : ${classe || 'primaire'}
Titre de la séance : "${titre}"

Le titre annonce le ou les faits de langue que les élèves doivent découvrir. Écris de 2 à 4 questions courtes, adressées à l'élève (tutoiement), qui amènent la classe à faire sortir elle-même le ou les faits annoncés par le titre, à partir des phrases ou du texte observés au tableau.
- Une question par fait annoncé par le titre. Si le titre n'en annonce qu'un seul, écris 2 questions : l'une pour le repérer, l'autre pour le faire expliquer.
- Chaque question tient en une seule phrase, reprend le vocabulaire du titre et ne contient pas la réponse.

Exemple de FORME uniquement (autre titre, ne le recopie pas), pour « Le féminin des noms » :
• Quels sont les noms qui désignent des filles ou des femelles dans ces phrases ?
• Que remarques-tu à la fin de ces noms par rapport aux noms masculins ?

Réponds UNIQUEMENT avec les questions, une par ligne, chacune commençant par « • ».`;
}

function parseQuestions(raw) {
  const out = [];
  String(raw || '').split('\n').forEach(line => {
    let t = line.trim().replace(/^[•\-–*\d.)\s]+/, '').trim();
    if (!t || t.length < 12 || t.length > 220 || !t.includes('?')) return;
    t = t.slice(0, t.lastIndexOf('?') + 1);
    if (!out.some(x => x.toLowerCase() === t.toLowerCase())) out.push(t);
  });
  return out.slice(0, 4).map(q => '• ' + q);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    if (!env.AI) return json({ ok: false, reason: 'ai-unavailable' }, 501);
    const body = await request.json();
    const titre = String(body.titre || '').trim().slice(0, 300);
    const matiere = String(body.matiere || '').trim().slice(0, 80);
    const classe = String(body.classe || '').trim().slice(0, 40);
    if (!titre) return json({ ok: false, reason: 'invalid-params' }, 400);
    const raw = await runFast(env, {
      prompt: buildPrompt(matiere, classe, titre),
      max_tokens: 220,
      temperature: 0.6
    });
    const questions = parseQuestions(raw);
    if (!questions.length) return json({ ok: false, reason: 'ai-empty' }, 502);
    return json({ ok: true, questions });
  } catch (err) {
    return json({ ok: false, reason: 'ai-busy', error: err.message }, 503);
  }
}
