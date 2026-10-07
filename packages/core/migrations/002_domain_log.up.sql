-- NF-RATE: every captured domain is logged for abuse review.
CREATE TABLE domain_log (
  id bigserial PRIMARY KEY,
  user_id uuid REFERENCES users(id) ON DELETE SET NULL,
  project_id uuid REFERENCES projects(id) ON DELETE SET NULL,
  domain text NOT NULL,
  url text NOT NULL,
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX domain_log_domain_idx ON domain_log(domain, created_at);
