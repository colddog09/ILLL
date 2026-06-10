-- ============================================================
-- 오일추 그룹 기능 스키마
-- Supabase → SQL Editor 에 붙여넣고 한 번 실행하세요.
-- (이미 실행한 적 있으면 다시 실행해도 안전하도록 작성됨)
-- ============================================================

-- ── 테이블 ──────────────────────────────────────────────────

create table if not exists public.groups (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 40),
  invite_code text unique not null,
  owner_id    uuid not null references auth.users(id) on delete cascade,
  created_at  timestamptz default now()
);

create table if not exists public.group_members (
  group_id     uuid not null references public.groups(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'member' check (role in ('owner','announcer','member')),
  display_name text,
  joined_at    timestamptz default now(),
  primary key (group_id, user_id)
);

create table if not exists public.group_announcements (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups(id) on delete cascade,
  author_id   uuid references auth.users(id) on delete set null,
  author_name text,
  text        text not null check (char_length(text) between 1 and 200),
  date        date,          -- null이면 '날짜 없는 일정' → 사용자 할일 풀로 추가
  deadline    jsonb,         -- 선택: {year,month,day,time}
  created_at  timestamptz default now()
);

create index if not exists idx_gm_user  on public.group_members(user_id);
create index if not exists idx_ga_group on public.group_announcements(group_id, created_at desc);

-- ── 헬퍼 함수 (SECURITY DEFINER → RLS 재귀 방지) ───────────────

create or replace function public.is_group_member(gid uuid, uid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists(select 1 from group_members where group_id = gid and user_id = uid);
$$;

create or replace function public.is_group_owner(gid uuid, uid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists(select 1 from groups where id = gid and owner_id = uid);
$$;

create or replace function public.can_announce(gid uuid, uid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists(select 1 from group_members
                where group_id = gid and user_id = uid and role in ('owner','announcer'));
$$;

-- ── RPC: 그룹 생성 (그룹 + owner 멤버십 원자적 생성) ───────────

create or replace function public.create_group(p_name text, p_display text)
returns public.groups language plpgsql security definer set search_path = public as $$
declare g public.groups; code text; tries int := 0;
begin
  loop
    code := upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
    begin
      insert into groups(name, invite_code, owner_id)
        values (left(trim(p_name),40), code, auth.uid()) returning * into g;
      exit;
    exception when unique_violation then
      tries := tries + 1;
      if tries > 5 then raise exception 'code_gen_failed'; end if;
    end;
  end loop;
  insert into group_members(group_id, user_id, role, display_name)
    values (g.id, auth.uid(), 'owner', nullif(left(trim(p_display),40),''));
  return g;
end; $$;

-- ── RPC: 초대 코드로 참여 ─────────────────────────────────────

create or replace function public.join_group_by_code(p_code text, p_display text)
returns public.groups language plpgsql security definer set search_path = public as $$
declare g public.groups;
begin
  select * into g from groups where invite_code = upper(trim(p_code));
  if g.id is null then raise exception 'invalid_code'; end if;
  insert into group_members(group_id, user_id, role, display_name)
    values (g.id, auth.uid(), 'member', nullif(left(trim(p_display),40),''))
    on conflict (group_id, user_id) do update set display_name = excluded.display_name;
  return g;
end; $$;

-- ── RLS ───────────────────────────────────────────────────────

alter table public.groups              enable row level security;
alter table public.group_members       enable row level security;
alter table public.group_announcements enable row level security;

-- groups: 멤버만 조회 / 본인 소유로만 생성 / owner만 수정·삭제
drop policy if exists groups_select on public.groups;
drop policy if exists groups_insert on public.groups;
drop policy if exists groups_update on public.groups;
drop policy if exists groups_delete on public.groups;
create policy groups_select on public.groups for select using (public.is_group_member(id, auth.uid()));
create policy groups_insert on public.groups for insert with check (owner_id = auth.uid());
create policy groups_update on public.groups for update using (owner_id = auth.uid());
create policy groups_delete on public.groups for delete using (owner_id = auth.uid());

-- group_members: 같은 그룹 멤버끼리 조회 / 본인 행 insert / owner가 역할변경 / 본인 탈퇴·owner 강퇴
drop policy if exists gm_select on public.group_members;
drop policy if exists gm_insert on public.group_members;
drop policy if exists gm_update on public.group_members;
drop policy if exists gm_delete on public.group_members;
create policy gm_select on public.group_members for select using (public.is_group_member(group_id, auth.uid()));
create policy gm_insert on public.group_members for insert with check (user_id = auth.uid());
create policy gm_update on public.group_members for update
  using (public.is_group_owner(group_id, auth.uid()))
  with check (public.is_group_owner(group_id, auth.uid()));
create policy gm_delete on public.group_members for delete
  using (user_id = auth.uid() or public.is_group_owner(group_id, auth.uid()));

-- group_announcements: 멤버 조회 / 공지권한자만 작성 / 작성자·owner 삭제
drop policy if exists ga_select on public.group_announcements;
drop policy if exists ga_insert on public.group_announcements;
drop policy if exists ga_delete on public.group_announcements;
create policy ga_select on public.group_announcements for select using (public.is_group_member(group_id, auth.uid()));
create policy ga_insert on public.group_announcements for insert
  with check (public.can_announce(group_id, auth.uid()) and author_id = auth.uid());
create policy ga_delete on public.group_announcements for delete
  using (author_id = auth.uid() or public.is_group_owner(group_id, auth.uid()));

-- ── 실시간(선택): 공지 즉시 반영하려면 아래도 실행 ─────────────
-- alter publication supabase_realtime add table public.group_announcements;

-- ============================================================
-- 푸시 구독 테이블 (Firestore 대체)
-- ============================================================

create table if not exists public.push_subscriptions (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  subscription jsonb not null,
  updated_at   timestamptz default now()
);

-- RLS: 본인 구독만 읽기/쓰기, 서비스 롤은 전체 접근
alter table public.push_subscriptions enable row level security;

drop policy if exists ps_select on public.push_subscriptions;
drop policy if exists ps_upsert on public.push_subscriptions;
drop policy if exists ps_delete on public.push_subscriptions;

create policy ps_select on public.push_subscriptions for select using (user_id = auth.uid());
create policy ps_upsert on public.push_subscriptions for insert with check (user_id = auth.uid());
create policy ps_delete on public.push_subscriptions for delete using (user_id = auth.uid());

-- ── 그룹별 알림 수신 설정 ────────────────────────────────────
alter table public.group_members
  add column if not exists notifications_enabled boolean not null default true;

-- ── 공지 종료일 컬럼 ─────────────────────────────────────────
alter table public.group_announcements
  add column if not exists date_end date;

-- ============================================================
-- 그룹 링크 테이블
-- ============================================================

create table if not exists public.group_links (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups(id) on delete cascade,
  author_id  uuid references auth.users(id) on delete set null,
  title      text not null check (char_length(title) between 1 and 80),
  url        text not null check (char_length(url) between 1 and 500),
  created_at timestamptz default now()
);

create index if not exists idx_gl_group on public.group_links(group_id, created_at desc);

alter table public.group_links enable row level security;

drop policy if exists gl_select on public.group_links;
drop policy if exists gl_insert on public.group_links;
drop policy if exists gl_delete on public.group_links;

create policy gl_select on public.group_links for select
  using (public.is_group_member(group_id, auth.uid()));
create policy gl_insert on public.group_links for insert
  with check (public.is_group_member(group_id, auth.uid()) and author_id = auth.uid());
create policy gl_delete on public.group_links for delete
  using (author_id = auth.uid() or public.is_group_owner(group_id, auth.uid()));
