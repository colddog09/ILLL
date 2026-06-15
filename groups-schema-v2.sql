-- ============================================================
-- 오일추 그룹 기능 v2 — 추가 마이그레이션
-- Supabase → SQL Editor 에 붙여넣고 한 번 실행하세요. (재실행 안전)
-- 기능: 공동그룹장 / 강퇴·가입승인제 / 공지 수정·고정 / 카테고리 / 댓글
-- ============================================================

-- ── 컬럼 추가 ────────────────────────────────────────────────
-- 멤버 상태(가입 승인제): active=정상, pending=승인대기
alter table public.group_members
  add column if not exists status text not null default 'active'
  check (status in ('active','pending'));

-- 비공개(가입 승인 필요) 그룹
alter table public.groups
  add column if not exists is_private boolean not null default false;

-- 공지 고정 / 카테고리
alter table public.group_announcements
  add column if not exists pinned boolean not null default false;
alter table public.group_announcements
  add column if not exists category text not null default 'none';

-- 역할에 coowner(공동 그룹장) 추가
alter table public.group_members drop constraint if exists group_members_role_check;
alter table public.group_members
  add constraint group_members_role_check
  check (role in ('owner','announcer','member','coowner'));

-- ── 헬퍼 함수 갱신 (active 멤버만 인정 + coowner 권한) ─────────
create or replace function public.is_group_member(gid uuid, uid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists(select 1 from group_members
    where group_id = gid and user_id = uid and status = 'active');
$$;

create or replace function public.can_announce(gid uuid, uid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists(select 1 from group_members
    where group_id = gid and user_id = uid
      and role in ('owner','announcer','coowner') and status = 'active');
$$;

-- 관리자(그룹장 + 공동그룹장)
create or replace function public.is_group_admin(gid uuid, uid uuid)
returns boolean language sql security definer stable set search_path = public as $$
  select exists(select 1 from group_members
    where group_id = gid and user_id = uid
      and role in ('owner','coowner') and status = 'active');
$$;

-- ── 가입(초대코드) RPC — 비공개면 pending ────────────────────
-- 반환 타입 변경(groups → json) 위해 기존 함수 먼저 제거
drop function if exists public.join_group_by_code(text, text);
create or replace function public.join_group_by_code(p_code text, p_display text)
returns json language plpgsql security definer set search_path = public as $$
declare g public.groups; v_status text; v_existing text;
begin
  select * into g from groups where invite_code = upper(trim(p_code));
  if g.id is null then raise exception 'invalid_code'; end if;

  -- 이미 active 멤버면 그대로 유지
  select status into v_existing from group_members
    where group_id = g.id and user_id = auth.uid();
  if v_existing = 'active' then
    return json_build_object('id', g.id, 'name', g.name, 'invite_code', g.invite_code,
                             'owner_id', g.owner_id, 'status', 'active');
  end if;

  v_status := case when g.is_private then 'pending' else 'active' end;
  insert into group_members(group_id, user_id, role, display_name, status)
    values (g.id, auth.uid(), 'member', nullif(left(trim(p_display),40),''), v_status)
    on conflict (group_id, user_id) do update set display_name = excluded.display_name;
  return json_build_object('id', g.id, 'name', g.name, 'invite_code', g.invite_code,
                           'owner_id', g.owner_id, 'status', v_status);
end; $$;

-- ── 멤버 승인 RPC (관리자만) ─────────────────────────────────
create or replace function public.approve_member(gid uuid, uid uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_group_admin(gid, auth.uid()) then
    raise exception 'not_authorized';
  end if;
  update group_members set status = 'active'
    where group_id = gid and user_id = uid and status = 'pending';
end; $$;

-- ── RLS 갱신 ─────────────────────────────────────────────────
-- groups: 관리자(그룹장+공동)도 이름 수정 가능
drop policy if exists groups_update on public.groups;
create policy groups_update on public.groups for update
  using (public.is_group_admin(id, auth.uid()));

-- group_members: 본인 행은 항상 조회(승인 대기 확인용)
drop policy if exists gm_select on public.group_members;
create policy gm_select on public.group_members for select
  using (public.is_group_member(group_id, auth.uid()) or user_id = auth.uid());

-- 강퇴: 본인 탈퇴 / 그룹장 전체 / 공동그룹장은 member·announcer만
drop policy if exists gm_delete on public.group_members;
create policy gm_delete on public.group_members for delete
  using (
    user_id = auth.uid()
    or public.is_group_owner(group_id, auth.uid())
    or (public.is_group_admin(group_id, auth.uid()) and role in ('member','announcer'))
  );

-- 공지 수정/고정: 작성자 또는 관리자
drop policy if exists ga_update on public.group_announcements;
create policy ga_update on public.group_announcements for update
  using (author_id = auth.uid() or public.is_group_admin(group_id, auth.uid()))
  with check (public.is_group_member(group_id, auth.uid()));

-- 공지 삭제: 작성자 또는 관리자
drop policy if exists ga_delete on public.group_announcements;
create policy ga_delete on public.group_announcements for delete
  using (author_id = auth.uid() or public.is_group_admin(group_id, auth.uid()));

-- ============================================================
-- 공지 댓글 테이블
-- ============================================================
create table if not exists public.group_comments (
  id              uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.group_announcements(id) on delete cascade,
  group_id        uuid not null references public.groups(id) on delete cascade,
  author_id       uuid references auth.users(id) on delete set null,
  author_name     text,
  text            text not null check (char_length(text) between 1 and 300),
  created_at      timestamptz default now()
);
create index if not exists idx_gc_ann on public.group_comments(announcement_id, created_at);

alter table public.group_comments enable row level security;
drop policy if exists gc_select on public.group_comments;
drop policy if exists gc_insert on public.group_comments;
drop policy if exists gc_delete on public.group_comments;
create policy gc_select on public.group_comments for select
  using (public.is_group_member(group_id, auth.uid()));
create policy gc_insert on public.group_comments for insert
  with check (public.is_group_member(group_id, auth.uid()) and author_id = auth.uid());
create policy gc_delete on public.group_comments for delete
  using (author_id = auth.uid() or public.is_group_admin(group_id, auth.uid()));
