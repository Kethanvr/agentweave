CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 100),
  slug text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  calls_allowed integer NOT NULL DEFAULT 100 CHECK (calls_allowed > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.org_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, user_id)
);

CREATE TABLE public.workflows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 120),
  description text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.workflow_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  position integer NOT NULL CHECK (position >= 0),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
  type text NOT NULL CHECK (type IN (
    'llm_call', 'http_request', 'db_write', 'notify',
    'conditional_branch', 'approval_gate'
  )),
  config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, position)
);

CREATE TABLE public.workflow_triggers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('manual', 'webhook', 'scheduled', 'database_event')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(config) = 'object'),
  secret_hash text,
  next_run_at timestamptz,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_id, type)
);

CREATE TABLE public.workflow_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  trigger_type text NOT NULL CHECK (trigger_type IN ('manual', 'webhook', 'scheduled', 'database_event')),
  triggered_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'paused', 'completed', 'failed')),
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  error text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.step_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_run_id uuid NOT NULL REFERENCES public.workflow_runs(id) ON DELETE CASCADE,
  workflow_step_id uuid REFERENCES public.workflow_steps(id) ON DELETE SET NULL,
  position integer NOT NULL,
  step_name text NOT NULL,
  step_type text NOT NULL,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN (
    'queued', 'running', 'awaiting_approval', 'completed', 'failed', 'skipped'
  )),
  input jsonb,
  output jsonb,
  error text,
  attempt_count integer NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  approved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (workflow_run_id, workflow_step_id)
);

CREATE TABLE public.organization_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  period_start date NOT NULL,
  calls_used integer NOT NULL DEFAULT 0 CHECK (calls_used >= 0),
  calls_allowed integer NOT NULL CHECK (calls_allowed > 0),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (org_id, period_start)
);

CREATE TABLE public.workflow_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  workflow_run_id uuid NOT NULL REFERENCES public.workflow_runs(id) ON DELETE CASCADE,
  data jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.notification_outbox (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workflow_run_id uuid NOT NULL REFERENCES public.workflow_runs(id) ON DELETE CASCADE,
  recipient text NOT NULL,
  subject text NOT NULL,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  provider_id text,
  error text,
  sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.workflow_inbox_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workflow_id uuid NOT NULL REFERENCES public.workflows(id) ON DELETE CASCADE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX org_members_user_id_idx ON public.org_members(user_id);
CREATE INDEX workflows_org_id_idx ON public.workflows(org_id);
CREATE INDEX workflow_steps_workflow_position_idx ON public.workflow_steps(workflow_id, position);
CREATE INDEX workflow_runs_workflow_created_idx ON public.workflow_runs(workflow_id, created_at DESC);
CREATE INDEX step_runs_run_position_idx ON public.step_runs(workflow_run_id, position);
CREATE INDEX notification_outbox_status_idx ON public.notification_outbox(status, created_at);
CREATE INDEX workflow_triggers_due_idx ON public.workflow_triggers(next_run_at) WHERE type = 'scheduled' AND is_active;

CREATE TRIGGER organizations_set_updated_at BEFORE UPDATE ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER workflows_set_updated_at BEFORE UPDATE ON public.workflows
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER workflow_steps_set_updated_at BEFORE UPDATE ON public.workflow_steps
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER workflow_triggers_set_updated_at BEFORE UPDATE ON public.workflow_triggers
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER workflow_runs_set_updated_at BEFORE UPDATE ON public.workflow_runs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER step_runs_set_updated_at BEFORE UPDATE ON public.step_runs
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER organization_usage_set_updated_at BEFORE UPDATE ON public.organization_usage
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER notification_outbox_set_updated_at BEFORE UPDATE ON public.notification_outbox
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE VIEW public.organization_current_usage AS
SELECT
  o.id AS org_id,
  date_trunc('month', now())::date AS period_start,
  COALESCE(u.calls_used, 0) AS calls_used,
  COALESCE(u.calls_allowed, o.calls_allowed) AS calls_allowed,
  GREATEST(COALESCE(u.calls_allowed, o.calls_allowed) - COALESCE(u.calls_used, 0), 0) AS calls_remaining
FROM public.organizations o
LEFT JOIN public.organization_usage u
  ON u.org_id = o.id
 AND u.period_start = date_trunc('month', now())::date;

COMMENT ON VIEW public.organization_current_usage IS
'Current calendar-month workflow usage, exposed as the required organization aggregation.';
