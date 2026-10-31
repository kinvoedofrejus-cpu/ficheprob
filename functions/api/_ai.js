// Utilitaires IA partagés (Cloudflare Workers AI) — utilisés par generate-assiste.js et generate-epreuve.js.
//
// Chaîne de modèles (31/10/2026) — écrite directement dans le code, plus aucune variable d'environnement à régler :
//   1. GPT-OSS 120B            — le plus performant : respecte la démarche et développe bien les consignes
//   2. DeepSeek V4.1 Flash     — modèle récent (MoE, raisonnement réglable), bien plus fort que Mistral Small 3.1,
//                                rapide et économique. Nécessite le plan Workers Paid : sinon l'appel échoue et la
//                                chaîne passe seule au modèle suivant.
//   3. Llama 3.3 70B           — secours
// Pour changer l'ordre ou un modèle : modifier les deux listes ci-dessous (mêmes modèles pour fiches et épreuves).
export const MODEL_GPT_OSS = '@cf/openai/gpt-oss-120b';
export const MODEL_DEEPSEEK = '@cf/deepseek-ai/deepseek-v4.1-flash-1017';
export const MODEL_LLAMA70 = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

export const AI_MODELS = [MODEL_GPT_OSS, MODEL_DEEPSEEK, MODEL_LLAMA70];           // fiches en mode assisté
export const AI_EPREUVE_MODELS = [MODEL_GPT_OSS, MODEL_DEEPSEEK, MODEL_LLAMA70];   // génération d'épreuves
export const AI_STALL_MS = 10000;   // si un modèle n'a pas répondu après ce délai, le suivant démarre en parallèle (sans l'interrompre)

export const isGptOss = model => /gpt-oss/i.test(String(model || ''));

// GPT-OSS parle l'API « Responses » (input + reasoning) ; les autres modèles, le format « chat » (messages).
// Pour GPT-OSS, le raisonnement est réglé sur « low » : réponse nettement plus rapide, largement assez pour
// suivre une démarche et rédiger des consignes. Une marge est ajoutée car les jetons de raisonnement comptent.
export const isDeepseek = model => /deepseek/i.test(String(model || ''));

export function runParams(model, p) {
  if (!p.prompt) return p;   // paramètres bruts déjà prêts
  if (isDeepseek(model)) {
    // Raisonnement « low » (défaut = high, bien plus lent) ; marge pour les jetons de raisonnement.
    return {
      messages: [{ role: 'user', content: p.prompt }],
      reasoning_effort: 'low',
      max_completion_tokens: (p.max_tokens || 2000) + 1000,
      temperature: p.temperature
    };
  }
  if (isGptOss(model)) {
    return {
      input: p.prompt,
      reasoning: { effort: 'low' },
      max_output_tokens: (p.max_tokens || 2000) + 1200,
      temperature: p.temperature
    };
  }
  return { messages: [{ role: 'user', content: p.prompt }], max_tokens: p.max_tokens, temperature: p.temperature };
}

// Les modèles ne répondent pas tous dans le même format : { response }, « chat » { choices:[…] }
// ou « Responses » { output:[{type:'message', content:[{type:'output_text', text}]}] }.
export function aiText(result) {
  if (!result) return '';
  if (typeof result === 'string') return result;
  if (typeof result.response === 'string' && result.response) return result.response;
  if (typeof result.output_text === 'string' && result.output_text) return result.output_text;
  if (Array.isArray(result.output)) {
    const txt = result.output
      .filter(o => o && o.type === 'message')
      .map(o => Array.isArray(o.content)
        ? o.content.map(c => (c && (c.text || '')) || '').join('')
        : (typeof o.content === 'string' ? o.content : ''))
      .join('\n').trim();
    if (txt) return txt;
  }
  const c = result.choices && result.choices[0];
  if (c) return (c.message && c.message.content) || c.text || '';
  if (typeof result.response === 'string') return result.response;
  return '';
}
