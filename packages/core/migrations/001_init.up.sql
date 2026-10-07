-- PRD data model: workspaces, users, projects, pages, captures, mockups, screens, renders, jobs.
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  plan text NOT NULL DEFAULT 'internal',
  usage jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  locale text NOT NULL DEFAULT 'en' CHECK (locale IN ('en', 'ar')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE projects (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  root_url text NOT NULL,
  title text NOT NULL DEFAULT '',
  language text NOT NULL DEFAULT 'en',
  viewports jsonb NOT NULL DEFAULT '{}'::jsonb,
  discovery jsonb NOT NULL DEFAULT '{"status":"idle"}'::jsonb,
  saved boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  url text NOT NULL,
  title text NOT NULL DEFAULT '',
  favicon_url text,
  template_group text,
  lang text,
  "order" integer NOT NULL DEFAULT 0,
  selected boolean NOT NULL DEFAULT false,
  source text NOT NULL DEFAULT 'discovered' CHECK (source IN ('discovered', 'manual')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, url)
);

CREATE TABLE captures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id uuid NOT NULL REFERENCES pages(id) ON DELETE CASCADE,
  device text NOT NULL CHECK (device IN ('desktop', 'tablet', 'mobile')),
  mode text NOT NULL DEFAULT 'fold' CHECK (mode IN ('fold', 'full')),
  width integer,
  height integer,
  image_key text,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  error text,
  source text NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'upload')),
  job_id uuid,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (page_id, device, mode)
);

CREATE TABLE mockups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  photo_key text NOT NULL,
  width integer NOT NULL,
  height integer NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  scene text,
  device_type text,
  tone text,
  licence_source text,
  licence_type text,
  attribution text,
  attribution_required boolean NOT NULL DEFAULT false,
  overlay_key text,
  light_map_key text,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published')),
  created_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE screens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mockup_id uuid NOT NULL REFERENCES mockups(id) ON DELETE CASCADE,
  screen_key text NOT NULL,
  device text NOT NULL CHECK (device IN ('desktop', 'tablet', 'mobile')),
  corners jsonb NOT NULL,
  corner_radius integer NOT NULL DEFAULT 0,
  mask_key text,
  z_index integer NOT NULL DEFAULT 1,
  UNIQUE (mockup_id, screen_key)
);

CREATE TABLE renders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  mockup_id uuid REFERENCES mockups(id) ON DELETE SET NULL,
  layout text NOT NULL DEFAULT 'mockup',
  assignments jsonb NOT NULL DEFAULT '{}'::jsonb,
  options jsonb NOT NULL DEFAULT '{}'::jsonb,
  outputs jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (type IN ('discover', 'capture', 'render', 'export')),
  project_id uuid REFERENCES projects(id) ON DELETE CASCADE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'done', 'failed')),
  error text,
  result jsonb,
  queued_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz
);

CREATE INDEX pages_project_idx ON pages(project_id);
CREATE INDEX captures_page_idx ON captures(page_id);
CREATE INDEX screens_mockup_idx ON screens(mockup_id);
CREATE INDEX renders_project_idx ON renders(project_id);
CREATE INDEX jobs_project_idx ON jobs(project_id);
