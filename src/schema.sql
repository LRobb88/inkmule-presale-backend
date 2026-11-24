-- Idempotent schema. Runs on every boot.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  name          TEXT,
  picture       TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at  TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS requests (
  id                       SERIAL PRIMARY KEY,
  job_name                 TEXT NOT NULL,
  job_key                  TEXT NOT NULL UNIQUE,        -- lower(trim(job_name)), keeps folder names unique
  client_name              TEXT,
  client_company           TEXT,
  client_email             TEXT NOT NULL,
  cc_emails                TEXT,
  rep_id                   INT REFERENCES users(id),
  artist_id                INT REFERENCES users(id),
  status                   TEXT NOT NULL DEFAULT 'new',
  position                 DOUBLE PRECISION NOT NULL DEFAULT 0,
  due_date                 DATE,
  notes                    TEXT,
  missive_conversation_id  TEXT,
  missive_subject          TEXT,
  dropbox_folder           TEXT,
  public_token             TEXT NOT NULL UNIQUE,
  link_shared_at           TIMESTAMPTZ,
  client_viewed_at         TIMESTAMPTZ,
  approved_at              TIMESTAMPTZ,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS requests_status_idx ON requests(status, position);
CREATE INDEX IF NOT EXISTS requests_convo_idx ON requests(missive_conversation_id);

CREATE TABLE IF NOT EXISTS request_items (
  id              SERIAL PRIMARY KEY,
  request_id      INT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  sort            INT NOT NULL DEFAULT 0,
  source          TEXT NOT NULL DEFAULT 'manual',  -- 'ss' | 'manual'
  product_type    TEXT,
  brand           TEXT,
  style           TEXT,
  title           TEXT,
  color_name      TEXT,
  color_hex       TEXT,
  swatch_url      TEXT,
  image_url       TEXT,
  back_image_url  TEXT,
  vendor_url      TEXT,
  ss_style_id     INT,
  decoration_type TEXT,
  sp_options      TEXT[] NOT NULL DEFAULT '{}',
  locations       TEXT[] NOT NULL DEFAULT '{}',
  print_colors    TEXT,
  item_notes      TEXT
);

CREATE TABLE IF NOT EXISTS files (
  id            SERIAL PRIMARY KEY,
  request_id    INT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  kind          TEXT NOT NULL,          -- 'artwork' | 'proof'
  name          TEXT NOT NULL,
  dropbox_path  TEXT,
  link_url      TEXT,                   -- pasted Dropbox shared link
  local_path    TEXT,                   -- dev fallback when Dropbox isn't configured
  size          BIGINT,
  mime          TEXT,
  created_by    INT REFERENCES users(id),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS proof_versions (
  id                     SERIAL PRIMARY KEY,
  request_id             INT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  version                INT NOT NULL,
  file_id                INT REFERENCES files(id),
  warnings               JSONB NOT NULL DEFAULT '[]',   -- [{key, text}]
  artist_note            TEXT,                          -- shown to the client
  sales_review_required  BOOLEAN NOT NULL DEFAULT false,
  sales_review_note      TEXT,
  sales_review_status    TEXT,                          -- pending | approved | returned
  sales_review_reply     TEXT,
  sales_review_by        INT REFERENCES users(id),
  sales_review_at        TIMESTAMPTZ,
  sent_via               TEXT,                          -- email | link
  sent_at                TIMESTAMPTZ,
  client_viewed_at       TIMESTAMPTZ,
  created_by             INT REFERENCES users(id),
  created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (request_id, version)
);

CREATE TABLE IF NOT EXISTS responses (
  id            SERIAL PRIMARY KEY,
  request_id    INT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  version_id    INT NOT NULL REFERENCES proof_versions(id) ON DELETE CASCADE,
  action        TEXT NOT NULL,          -- approved | changes
  signer_name   TEXT,
  comment       TEXT,
  acknowledged  JSONB NOT NULL DEFAULT '[]',
  ip            TEXT,
  user_agent    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS activity (
  id          SERIAL PRIMARY KEY,
  request_id  INT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  user_id     INT REFERENCES users(id),
  actor       TEXT,                     -- display name for non-staff actors (client, system)
  kind        TEXT NOT NULL,            -- comment | status | proof | sent | review | client | system
  body        TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS activity_req_idx ON activity(request_id, created_at);

CREATE TABLE IF NOT EXISTS settings (
  key    TEXT PRIMARY KEY,
  value  JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_handoffs (
  nonce       TEXT PRIMARY KEY,
  token       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS ss_styles (
  style_id       INT PRIMARY KEY,
  part_number    TEXT,
  brand_name     TEXT,
  style_name     TEXT,
  title          TEXT,
  base_category  TEXT,
  style_image    TEXT,
  search_text    TEXT,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- v2.1: proofs and artwork are tied to individual products.
ALTER TABLE proof_versions ADD COLUMN IF NOT EXISTS item_id INT REFERENCES request_items(id) ON DELETE CASCADE;
ALTER TABLE proof_versions ADD COLUMN IF NOT EXISTS batch_id TEXT;   -- versions created together from one upload
ALTER TABLE files ADD COLUMN IF NOT EXISTS item_id INT REFERENCES request_items(id) ON DELETE SET NULL;
ALTER TABLE proof_versions DROP CONSTRAINT IF EXISTS proof_versions_request_id_version_key;
UPDATE proof_versions v SET item_id = (SELECT id FROM request_items i WHERE i.request_id = v.request_id ORDER BY sort, id LIMIT 1)
  WHERE item_id IS NULL;
UPDATE proof_versions SET batch_id = 'b' || id WHERE batch_id IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS proof_versions_item_version_idx ON proof_versions(item_id, version);
CREATE INDEX IF NOT EXISTS proof_versions_req_idx ON proof_versions(request_id);

-- v2.2: Mac/browser push notifications.
ALTER TABLE users ADD COLUMN IF NOT EXISTS notify_prefs JSONB;
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id          SERIAL PRIMARY KEY,
  user_id     INT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL UNIQUE,
  keys        JSONB NOT NULL,
  user_agent  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- v2.3: which decorator (print/embroidery shop) does the job.
ALTER TABLE request_items ADD COLUMN IF NOT EXISTS decorator TEXT;

-- v2.4: ad-hoc design / mockup requests (lighter form, client optional).
ALTER TABLE requests ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'proof';
ALTER TABLE requests ALTER COLUMN client_email DROP NOT NULL;

-- v2.5: approved proofs get an APPROVED copy in Proofs/Approved.
ALTER TABLE proof_versions ADD COLUMN IF NOT EXISTS approved_file_id INT REFERENCES files(id);

-- v2.6: several garment colors per product (S&S picker).
ALTER TABLE request_items ADD COLUMN IF NOT EXISTS colors JSONB NOT NULL DEFAULT '[]';

-- v2.7: extra garments that run together with the product's print (same proof).
ALTER TABLE request_items ADD COLUMN IF NOT EXISTS garments JSONB NOT NULL DEFAULT '[]';

-- v2.8: optional job subname per product/group → file name JOBNAME-SUBNAME.
ALTER TABLE request_items ADD COLUMN IF NOT EXISTS subname TEXT;
