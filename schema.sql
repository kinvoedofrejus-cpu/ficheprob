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
