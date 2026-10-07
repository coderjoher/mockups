-- Phase 9: brand colours (CX-3), capture cache (CE-12), share links (EX-4), favourites (ML-3).
ALTER TABLE projects ADD COLUMN brand_colors jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE captures ADD COLUMN cache_key text;
CREATE INDEX captures_cache_idx ON captures(cache_key, updated_at) WHERE status = 'done' AND source = 'auto';

CREATE TABLE share_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token text NOT NULL UNIQUE,
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);

CREATE TABLE favourites (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mockup_id uuid NOT NULL REFERENCES mockups(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, mockup_id)
);
