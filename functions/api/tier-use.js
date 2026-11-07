import {
  json, normalizePhone, getUser, ensureDownloadTables, getUsage, incUsage,
  getTierLimits, tierOfUser, TIER_FEATURES, TIER_LABELS, tierPeriodKey, tierUsageKind, tierLimitFor
} from './_shared.js';
import { OWNER_PHONE_HARDCODED, OWNER_CODE_HARDCODED } from './user-login.js';

/* Cloudflare Function — /api/tier-use   (niveaux de compte, novembre 2026)
   Contrôle et décompte du NOMBRE D'ACCÈS d'un compte à chaque fonctionnalité, selon le niveau (réglé par l'admin).
   Body : { phone, code, action: 'status' | 'check' | 'consume', feature? }
     - status  : renvoie le niveau et, pour chaque fonctionnalité, { limit, used, remaining } ;
     - check   : feature requis ; dit si un accès supplémentaire est permis, sans le décompter ;
     - consume : feature requis ; décompte 1 accès s'il en reste (sinon refuse).
   limit = -1 : illimité ; 0 : pas d'accès à ce niveau. Le compte propriétaire et les ambassadeurs sont illimités. */
export async function onRequestPost(context) {
  const { request, env } = context;
  const db = env.FPB_DB;
  try {
    const { phone, code, action, feature } = await request.json();
    const phoneDigits = normalizePhone(phone);
    const cleanCode = String(code || '').trim().toUpperCase();
    if (phoneDigits.length < 8 || !cleanCode || !['status', 'check', 'consume'].includes(action)) {
      return json({ ok: false, reason: 'invalid' }, 400);
    }
    if (action !== 'status' && !TIER_FEATURES.some(f => f.key === feature)) {
      return json({ ok: false, reason: 'invalid' }, 400);
    }

    // Compte propriétaire : tout est illimité.
    if (phoneDigits === normalizePhone(OWNER_PHONE_HARDCODED) && cleanCode === OWNER_CODE_HARDCODED.toUpperCase()) {
      if (action === 'status') {
        const feats = {};
        TIER_FEATURES.forEach(f => { feats[f.key] = { limit: -1, used: 0, remaining: -1 }; });
        return json({ ok: true, tier: 'premium', features: feats });
      }
      return json({ ok: true, allowed: true, limit: -1, used: 0, remaining: -1 });
    }

    const record = await getUser(db, phoneDigits);
    if (!record || (record.code || '').toUpperCase() !== cleanCode) return json({ ok: false, reason: 'invalid' }, 401);
    if (!record.active) return json({ ok: false, reason: 'inactive' }, 403);
    if (record.expiryTs <= Date.now()) return json({ ok: false, reason: 'expired' }, 403);

    await ensureDownloadTables(db);
    const limits = await getTierLimits(db);
    const tier = tierOfUser(record);

    const read = async (key) => {
      const limit = tierLimitFor(limits, record, key);
      const used = await getUsage(db, phoneDigits, tierUsageKind(key), tierPeriodKey(key, record));
      return { limit, used, remaining: limit < 0 ? -1 : Math.max(0, limit - used) };
    };

    if (action === 'status') {
      const feats = {};
      for (const f of TIER_FEATURES) feats[f.key] = await read(f.key);
      return json({ ok: true, tier, tierLabel: TIER_LABELS[tier], features: feats });
    }

    const st = await read(feature);
    const allowed = st.limit < 0 || st.used < st.limit;
    if (!allowed) {
      return json({ ok: false, allowed: false, reason: st.limit === 0 ? 'not_in_tier' : 'limit_reached', tier, tierLabel: TIER_LABELS[tier], ...st });
    }
    if (action === 'consume' && st.limit >= 0) {
      await incUsage(db, phoneDigits, tierUsageKind(feature), tierPeriodKey(feature, record));
      st.used += 1;
      st.remaining = Math.max(0, st.limit - st.used);
    }
    return json({ ok: true, allowed: true, tier, ...st });
  } catch (err) {
    return json({ error: "Erreur lors de la vérification de l'accès : " + err.message }, 500);
  }
}
