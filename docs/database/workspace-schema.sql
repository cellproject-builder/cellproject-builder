-- DESIGN DRAFT ONLY. Not applied SQL and not a Supabase migration.
-- Target: a future Supabase project using PostgreSQL 15+ and Supabase Auth.
-- Existing local nanoid IDs are TEXT. Only owner_id uses auth.users UUIDs.
-- Review/test in a disposable local Supabase instance before generating a migration.
-- Never run this against an existing public schema without reviewing name conflicts.

begin;

create table public.workspace_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  legacy_imported boolean not null default false
);

create table public.projects (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (length(id) > 0),
  name text not null check (length(btrim(name)) > 0),
  objective text not null default '',
  archived boolean not null default false,
  -- The full per-project planner snapshot preserves graph nodes/edges, drafts,
  -- paid suggestions, objective drafts and archives without flattening their schema.
  planner_snapshot jsonb check (planner_snapshot is null or jsonb_typeof(planner_snapshot) = 'object'),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (owner_id, id)
);

create table public.sprints (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (length(id) > 0),
  project_id text not null,
  name text not null check (length(btrim(name)) > 0),
  goal text not null default '',
  start_date date not null,
  end_date date not null,
  status text not null default 'planned' check (status in ('planned', 'active', 'completed')),
  created_at timestamptz not null,
  completed_at timestamptz,
  primary key (owner_id, id),
  unique (owner_id, project_id, id),
  foreign key (owner_id, project_id) references public.projects(owner_id, id),
  check (end_date >= start_date),
  check ((status = 'completed') = (completed_at is not null))
);

-- One active sprint per project, also under concurrent remote writes.
create unique index sprints_one_active_per_project
  on public.sprints(owner_id, project_id) where status = 'active';

create table public.tasks (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (length(id) > 0),
  project_id text not null,
  title text not null check (length(btrim(title)) > 0),
  description text not null default '',
  status text not null default 'todo' check (status in ('todo', 'doing', 'review', 'done')),
  priority text not null default 'medium' check (priority in ('low', 'medium', 'high')),
  -- Local dueDate = '' is exported as SQL NULL.
  due_date date,
  sprint_id text,
  -- Source nodes live inside planner_snapshot, so these are provenance text IDs,
  -- not foreign keys into a separate graph table.
  source_node_id text,
  source_plan_id text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (owner_id, id),
  unique (owner_id, project_id, id),
  foreign key (owner_id, project_id) references public.projects(owner_id, id),
  foreign key (owner_id, project_id, sprint_id) references public.sprints(owner_id, project_id, id)
);

create unique index tasks_plan_source_once
  on public.tasks(owner_id, project_id, source_plan_id, source_node_id)
  where source_plan_id is not null and source_node_id is not null;

create table public.folders (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (length(id) > 0),
  name text not null check (length(btrim(name)) > 0),
  primary key (owner_id, id)
);

create table public.notes (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (length(id) > 0),
  title text not null default '',
  -- Ordered blocks retain IDs, type, text, checked/bold/italic as JSONB.
  -- No synthetic timestamps or IDs are invented for these embedded objects.
  blocks jsonb not null default '[]'::jsonb check (jsonb_typeof(blocks) = 'array'),
  project_id text,
  task_id text,
  folder_id text,
  pinned boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (owner_id, id),
  foreign key (owner_id, project_id) references public.projects(owner_id, id),
  foreign key (owner_id, project_id, task_id) references public.tasks(owner_id, project_id, id)
    on delete set null (task_id),
  foreign key (owner_id, folder_id) references public.folders(owner_id, id)
    on delete set null (folder_id),
  check (task_id is null or project_id is not null)
);

create table public.task_comments (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (length(id) > 0),
  project_id text not null,
  task_id text not null,
  body text not null check (length(btrim(body)) > 0),
  -- Author identifies the display speaker; it never grants permissions.
  author text not null check (author in ('user', 'assistant')),
  created_at timestamptz not null,
  updated_at timestamptz not null,
  primary key (owner_id, id),
  foreign key (owner_id, project_id, task_id) references public.tasks(owner_id, project_id, id)
    on delete cascade
);

-- Future chat history is a separate persistence scope. These two tables are
-- aligned with the local dynamic_diary-chat session data. Chat uses its own
-- export function; WorkspaceData does not contain conversations or credentials.
create table public.chat_sessions (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (length(id) > 0),
  -- Model context includes structured tool turns. The exporter omits provider
  -- configuration/known credential fields; credentials are never session data.
  model_history jsonb not null default '[]'::jsonb check (jsonb_typeof(model_history) = 'array'),
  primary key (owner_id, id)
);

create table public.chat_messages (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (length(id) > 0),
  session_id text not null,
  position integer not null check (position >= 0),
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  actions jsonb not null default '[]'::jsonb check (jsonb_typeof(actions) = 'array'),
  interrupted boolean not null default false,
  created_at timestamptz not null,
  primary key (owner_id, id),
  unique (owner_id, session_id, position),
  foreign key (owner_id, session_id) references public.chat_sessions(owner_id, id) on delete cascade
);

-- Owner-first indexes support RLS ownership predicates and app list filters.
-- Primary keys and the composite UNIQUE constraints already supply other indexes.
create index projects_archive_updated on public.projects(owner_id, archived, updated_at desc);
create index tasks_board on public.tasks(owner_id, project_id, status, created_at);
create index tasks_sprint on public.tasks(owner_id, project_id, sprint_id);
create index notes_project_task on public.notes(owner_id, project_id, task_id);
create index notes_folder on public.notes(owner_id, folder_id);
create index notes_list on public.notes(owner_id, deleted_at, pinned desc, updated_at desc);
create index task_comments_thread on public.task_comments(owner_id, project_id, task_id, created_at, id);

-- Lifecycle operations such as completing a sprint require one future transaction:
-- detach unfinished tasks, preserve completed historical tasks, then mark the sprint
-- completed. CHECK constraints do not enforce cross-row transitions. The future
-- remote domain service/RPC must enforce the same rules as the local actions.
-- No hard-delete-project action exists today; project references restrict deletion.

alter table public.workspace_settings enable row level security;
alter table public.projects enable row level security;
alter table public.sprints enable row level security;
alter table public.tasks enable row level security;
alter table public.folders enable row level security;
alter table public.notes enable row level security;
alter table public.task_comments enable row level security;
alter table public.chat_sessions enable row level security;
alter table public.chat_messages enable row level security;

-- FOR ALL supplies SELECT as well as INSERT/UPDATE/DELETE policies. WITH CHECK
-- prevents changing ownership on UPDATE; the composite FKs prevent linking to
-- another owner's rows even when two owners happen to use identical text IDs.
create policy workspace_settings_owner on public.workspace_settings for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy projects_owner on public.projects for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy sprints_owner on public.sprints for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy tasks_owner on public.tasks for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy folders_owner on public.folders for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy notes_owner on public.notes for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy task_comments_owner on public.task_comments for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy chat_sessions_owner on public.chat_sessions for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);
create policy chat_messages_owner on public.chat_messages for all to authenticated
  using ((select auth.uid()) = owner_id) with check ((select auth.uid()) = owner_id);

revoke all on table public.workspace_settings, public.projects, public.sprints,
  public.tasks, public.folders, public.notes, public.task_comments,
  public.chat_sessions, public.chat_messages from public, anon, authenticated;
grant select, insert, update, delete on table public.workspace_settings, public.projects,
  public.sprints, public.tasks, public.folders, public.notes, public.task_comments,
  public.chat_sessions, public.chat_messages to authenticated;

commit;
