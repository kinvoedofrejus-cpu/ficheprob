import { json } from './_shared.js';

// Cloudflare Function — /api/generate-points
//
// Petit travail, IA très rapide : dans les « Activités de construction de nouveaux savoirs » (Mode Assisté, TOUTES
// les matières), le titre annonce ce que les élèves doivent découvrir (fait de langue, notion, texte, thème…).
// Cette fonction ne produit que 2 ou 3 questions, dans le sens des ÉTAPES de la démarche de la matière (ex. « identifier le fait
// dans des phrases, le manipuler, dégager la règle ») : une question par étape, hors étape « règle » (déjà
// présente dans la démarche). Jamais de question pour les autres phases de la fiche.
//   requête  { matiere, classe, titre, seed, etapes, resume }
//   réponse  { ok:true, questions:["• Question ?", ...] }
// Modèles légers, essayés dans l'ordre (réglable : variable AI_FAST_MODELS, liste séparée par des virgules).
// Un échec n'est jamais bloquant : le front garde simplement le texte de la démarche tel quel.

const DEFAULT_FAST_MODELS = [
  '@cf/meta/llama-3.2-3b-instruct',
  '@cf/meta/llama-3.1-8b-instruct-fp8'
];
const FAST_TIMEOUT_MS = 4500;   // par modèle : au pire ~9 s pour les deux, sans bloquer la fiche

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

const MAX_QUESTIONS = 3;

function buildPrompt(matiere, classe, titre, etapes, resume) {
  const hasEtapes = !!etapes;
  const consigne = hasEtapes
    ? `Écris UNE question par étape de la démarche ci-dessus, dans l'ordre des étapes, SAUF pour l'étape « dégager la règle » (elle est déjà prévue ailleurs : n'écris aucune question pour elle). Ne pose AUCUNE question sur les autres phases de la leçon (rappel, mise en situation, pré-requis, évaluation…). Au total : 2 ou 3 questions, jamais plus.`
    : `Écris 2 questions : l'une pour observer ou repérer ce qu'annonce le titre, l'autre pour le faire expliquer ou manipuler. Ne pose aucune question sur les autres phases de la leçon.`;
  return `Tu aides un(e) enseignant(e) du primaire au Bénin à préparer la phase « Activités de construction de nouveaux savoirs ».

Matière : ${matiere || 'Français'}
Classe : ${classe || 'primaire'}
Titre de la séance : "${titre}"
${hasEtapes ? `Étapes de la démarche à suivre, dans cet ordre : ${etapes}\n` : ''}${resume ? `Résumé de la leçon (pour rester fidèle au contenu) : ${resume}\n` : ''}
${consigne}
- Chaque question est adressée à l'élève (tutoiement), tient en UNE seule phrase courte, reprend le vocabulaire du titre, porte sur ce que les élèves observent (phrases, texte, image, situation ou matériel de la leçon) et ne contient JAMAIS la réponse.

Exemple de FORME uniquement (autre titre, ne le recopie pas), pour « Le féminin des noms » :
• Quels sont les noms qui désignent des filles ou des femelles dans ces phrases ?
• Comment changes-tu ces noms masculins pour obtenir le féminin ?

Réponds UNIQUEMENT avec les questions, une par ligne, chacune commençant par « • ».`;
}

function parseQuestions(raw) {
  const out = [];
  String(raw || '').split('\n').forEach(line => {
    let t = line.trim().replace(/^[•\-–*\d.)\s]+/, '').trim();
    if (!t || t.length < 12 || t.length > 220 || !t.includes('?')) return;
    t = t.slice(0, t.lastIndexOf('?') + 1);
    // Question sur la règle : déjà couverte par la ligne « Dégage la règle » de la démarche.
    if (/\b(r[èe]gle)\b/i.test(t)) return;
    if (!out.some(x => x.toLowerCase() === t.toLowerCase())) out.push(t);
  });
  return out.slice(0, MAX_QUESTIONS).map(q => '• ' + q);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  try {
    if (!env.AI) return json({ ok: false, reason: 'ai-unavailable' }, 501);
    const body = await request.json();
    const titre = String(body.titre || '').trim().slice(0, 300);
    const matiere = String(body.matiere || '').trim().slice(0, 80);
    const classe = String(body.classe || '').trim().slice(0, 40);
    const etapes = String(body.etapes || '').trim().slice(0, 400);
    const resume = String(body.resume || '').trim().slice(0, 1200);
    if (!titre) return json({ ok: false, reason: 'invalid-params' }, 400);
    const raw = await runFast(env, {
      prompt: buildPrompt(matiere, classe, titre, etapes, resume),
      max_tokens: 180,
      temperature: 0.6
    });
    const questions = parseQuestions(raw);
    if (!questions.length) return json({ ok: false, reason: 'ai-empty' }, 502);
    return json({ ok: true, questions });
  } catch (err) {
    return json({ ok: false, reason: 'ai-busy', error: err.message }, 503);
  }
}
