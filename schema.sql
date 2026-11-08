-- Schéma D1 pour FicheProBot — remplace le stockage KV.
-- À appliquer avec : wrangler d1 execute ficheprobot-db --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS users (
  phone        TEXT PRIMARY KEY,
  nom          TEXT NOT NULL,
  prenom       TEXT,
  code         TEXT UNIQUE,
  plan_index   INTEGER,
  plan_label   TEXT,
  classe       TEXT,
  expiry_ts    INTEGER,
  quota_total  INTEGER,
  quota_used   INTEGER DEFAULT 0,
  active       INTEGER DEFAULT 1,
  history      TEXT DEFAULT '[]',   -- JSON array
  promo        TEXT,                -- JSON object ou NULL
  created_at   INTEGER,
  updated_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_users_updated_at ON users(updated_at);

CREATE TABLE IF NOT EXISTS transactions (
  id           TEXT PRIMARY KEY,
  type         TEXT DEFAULT 'subscription', -- 'subscription' | 'resume'
  source       TEXT,                        -- 'fedapay' | 'manuel' | 'promo' | 'attribution_groupee'
  status       TEXT,                        -- 'pending' | 'paid' | 'failed' | 'paid_unmatched'
  plan_index   INTEGER,
  phone        TEXT,
  nom          TEXT,
  prenom       TEXT,
  amount       INTEGER,
  code         TEXT,
  classe       TEXT,
  matiere      TEXT,
  tier         TEXT,
  paid_at      INTEGER,
  created_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_tx_created_at ON transactions(created_at);
CREATE INDEX IF NOT EXISTS idx_tx_status ON transactions(status);

CREATE TABLE IF NOT EXISTS promos (
  id           TEXT PRIMARY KEY,
  plan_index   INTEGER,
  start_at     INTEGER,
  end_at       INTEGER,
  message      TEXT,
  enabled      INTEGER DEFAULT 1,
  created_at   INTEGER
);

CREATE TABLE IF NOT EXISTS resumes (
  id           TEXT PRIMARY KEY,
  matiere      TEXT,
  classe       TEXT,
  unite        TEXT,
  sa           TEXT,
  sequence     TEXT,
  dossier      TEXT,
  titre        TEXT,
  texte        TEXT,
  images       TEXT DEFAULT '[]', -- JSON array d'URLs
  created_at   INTEGER,
  updated_at   INTEGER
);
CREATE INDEX IF NOT EXISTS idx_resumes_updated_at ON resumes(updated_at);
CREATE INDEX IF NOT EXISTS idx_resumes_classe_matiere ON resumes(classe, matiere);

CREATE TABLE IF NOT EXISTS hidden_matieres (
  classe       TEXT NOT NULL,
  matiere      TEXT NOT NULL,
  PRIMARY KEY (classe, matiere)
);

CREATE TABLE IF NOT EXISTS hidden_classes (
  classe       TEXT NOT NULL,
  PRIMARY KEY (classe)
);

CREATE TABLE IF NOT EXISTS resume_downloads (
  phone        TEXT NOT NULL,
  ts           INTEGER NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'single'  -- 'single' (résumé à l'unité) | 'bulk' (toute une classe / toutes les classes)
);
CREATE INDEX IF NOT EXISTS idx_resume_downloads_phone ON resume_downloads(phone, kind, ts);
-- Migration (base déjà existante sans la colonne "kind") : exécuter une seule fois si la
-- colonne n'existe pas déjà —
--   ALTER TABLE resume_downloads ADD COLUMN kind TEXT NOT NULL DEFAULT 'single';
--   CREATE INDEX IF NOT EXISTS idx_resume_downloads_phone ON resume_downloads(phone, kind, ts);

CREATE TABLE IF NOT EXISTS resume_purchases (
  phone        TEXT NOT NULL,
  classe       TEXT NOT NULL,
  matiere      TEXT NOT NULL,
  purchased_at INTEGER,
  tx_id        TEXT,
  PRIMARY KEY (phone, classe, matiere)
);

CREATE TABLE IF NOT EXISTS readyfiche_purchases (
  phone        TEXT NOT NULL,
  classe       TEXT NOT NULL,
  matiere      TEXT NOT NULL,   -- '*' = toute la classe (tier 'classe')
  tier         TEXT,            -- 'matiere' | 'classe'
  purchased_at INTEGER,
  tx_id        TEXT,
  PRIMARY KEY (phone, classe, matiere)
);
CREATE INDEX IF NOT EXISTS idx_readyfiche_purchases_phone ON readyfiche_purchases(phone);

CREATE TABLE IF NOT EXISTS readyfiche_downloads (
  phone          TEXT NOT NULL,
  classe         TEXT NOT NULL,
  matiere        TEXT NOT NULL,
  downloaded_at  INTEGER,
  PRIMARY KEY (phone, classe, matiere)
);

-- 1er téléchargement offert (matière complète de résumés, ressources) :
-- une ligne par (compte, type, référence) dès que le téléchargement gratuit a été consommé.
-- kind = 'matiere' (ref = "classe::matiere") | 'resource' (ref = id de la ressource)
CREATE TABLE IF NOT EXISTS first_downloads (
  phone        TEXT NOT NULL,
  kind         TEXT NOT NULL,
  ref          TEXT NOT NULL,
  ts           INTEGER,
  PRIMARY KEY (phone, kind, ref)
);

-- Ressources didactiques achetées (à partir du 2e téléchargement d'une ressource)
CREATE TABLE IF NOT EXISTS resource_purchases (
  phone        TEXT NOT NULL,
  resource_id  TEXT NOT NULL,
  purchased_at INTEGER,
  tx_id        TEXT,
  PRIMARY KEY (phone, resource_id)
);

-- Demandes « Devenir Ambassadeur FicheProBot » (la table est aussi créée automatiquement
-- par les fonctions /api/submit-ambassador et /api/admin-*-ambassador au premier appel).
-- numero = numéro de traitement AMB-AAAA-NNNN ; status = nouveau | contacte | accepte | refuse
CREATE TABLE IF NOT EXISTS ambassadors (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  numero      TEXT,
  nom         TEXT NOT NULL,
  prenoms     TEXT NOT NULL,
  statut      TEXT NOT NULL,
  fonction    TEXT NOT NULL,
  residence   TEXT NOT NULL,
  lieu        TEXT NOT NULL,
  phone       TEXT NOT NULL,
  email       TEXT,
  status      TEXT NOT NULL DEFAULT 'nouveau',
  created_at  INTEGER NOT NULL,
  code        TEXT,      -- code d'accès du compte ambassadeur (créé à l'acceptation)
  expiry_ts   INTEGER,   -- fin de validité (1 an, renouvelable)
  accepted_at INTEGER
);
-- Base déjà existante : les 3 colonnes ci-dessus sont ajoutées automatiquement au premier appel
-- des fonctions ambassadeurs (ensureAmbassadorsTable). Sinon, à lancer une seule fois :
--   ALTER TABLE ambassadors ADD COLUMN code TEXT;
--   ALTER TABLE ambassadors ADD COLUMN expiry_ts INTEGER;
--   ALTER TABLE ambassadors ADD COLUMN accepted_at INTEGER;
-- Le compte ambassadeur lui-même est une ligne de "users" avec plan_index = 99 (plan_label 'Ambassadeur').

-- Réglages globaux (clé/valeur), onglet "Abonnements" du dashboard admin :
--   app_mode          : 'payant' (normal) | 'gratuit' (tout le monde génère sans abonnement)
--   app_mode_until     : date de fin automatique du mode gratuit (ou null = manuel uniquement)
--   min_plan_bonus     : fiches offertes en plus à chaque souscription de la formule la moins chère
--   plan_amounts       : tableau JSON des 4 prix courants (FCFA), remplace PLANS[i].amount par défaut
-- La table est créée automatiquement au premier appel (ensureSettingsTable) : rien à lancer à la main.
CREATE TABLE IF NOT EXISTS settings (
  key          TEXT PRIMARY KEY,
  value        TEXT
);

-- Téléchargements (règles du 12/10/2026) — tables aussi créées automatiquement par les fonctions au 1er appel.
-- owner = téléphone du compte, ou "d<identifiant d'appareil>" pour un visiteur sans compte.
CREATE TABLE IF NOT EXISTS download_usage (
  owner TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner, kind, ref)
);
CREATE TABLE IF NOT EXISTS download_credits (
  owner TEXT PRIMARY KEY, credits INTEGER NOT NULL DEFAULT 0
);

-- Suggestions, corrections et signalements d'erreurs (créée aussi automatiquement par le serveur)
CREATE TABLE IF NOT EXISTS suggestions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  numero      TEXT,
  type        TEXT NOT NULL,   -- suggestion | correction | erreur | autre
  concerne    TEXT,
  classe      TEXT,
  matiere     TEXT,
  message     TEXT NOT NULL,
  nom         TEXT,
  phone       TEXT,
  status      TEXT NOT NULL DEFAULT 'nouveau',  -- nouveau | lu | traite
  created_at  INTEGER NOT NULL
);

-- Téléchargements faits par l'admin POUR un client (onglet admin « Télécharger pour un client », novembre 2026).
-- Table aussi créée automatiquement par /api/admin-client-download au 1er appel.
CREATE TABLE IF NOT EXISTS admin_downloads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  phone TEXT, kind TEXT, classe TEXT, matiere TEXT, format TEXT, nom TEXT, filigrane INTEGER, created_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_admin_downloads_phone ON admin_downloads(phone, created_at);

-- Sauvegarde / synchronisation de l'historique des fiches (novembre 2026).
-- Créée automatiquement par /api/sync-fiches au premier appel : rien à exécuter, définition donnée ici pour mémoire.
CREATE TABLE IF NOT EXISTS fiches_sync (
  phone      TEXT NOT NULL,
  id         TEXT NOT NULL,
  data       TEXT,                 -- JSON de la fiche (NULL si supprimée)
  updated_at INTEGER NOT NULL,     -- horloge de l'appareil : sert à départager deux versions
  synced_at  INTEGER NOT NULL,     -- horloge du serveur : curseur de synchronisation
  deleted    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (phone, id)
);
CREATE INDEX IF NOT EXISTS idx_fiches_sync_cursor ON fiches_sync (phone, synced_at);


-- Notifications (novembre 2026) : tables créées automatiquement au premier appel (rien à exécuter), reprises ici pour mémoire.
CREATE TABLE IF NOT EXISTS contacts (
  phone TEXT PRIMARY KEY, email TEXT, whatsapp TEXT,
  opt_email INTEGER NOT NULL DEFAULT 0, opt_whatsapp INTEGER NOT NULL DEFAULT 0, opt_push INTEGER NOT NULL DEFAULT 0,
  consent_at INTEGER, unsub_token TEXT, source TEXT, created_at INTEGER, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS push_subs (
  endpoint TEXT PRIMARY KEY, phone TEXT NOT NULL, p256dh TEXT NOT NULL, auth TEXT NOT NULL, ua TEXT, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS broadcasts (
  id TEXT PRIMARY KEY, title TEXT, body TEXT, url TEXT, channels TEXT, audience TEXT,
  total INTEGER DEFAULT 0, push_sent INTEGER DEFAULT 0, email_sent INTEGER DEFAULT 0, wa_sent INTEGER DEFAULT 0,
  failed INTEGER DEFAULT 0, status TEXT, created_at INTEGER, finished_at INTEGER
);
CREATE TABLE IF NOT EXISTS notif_log (phone TEXT NOT NULL, kind TEXT NOT NULL, ref TEXT NOT NULL, ts INTEGER, PRIMARY KEY (phone, kind, ref));
