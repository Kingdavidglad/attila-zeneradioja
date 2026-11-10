-- Attila Zenerádiója – kapcsolatfelvételi üzenetek táblája
-- Futtatás: Supabase Dashboard > SQL Editor > New query > Run

create table if not exists public.contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 100),
  email text not null check (char_length(email) between 3 and 254),
  phone text not null check (char_length(phone) between 3 and 40),
  message text not null check (char_length(message) between 5 and 5000),
  status text not null default 'new' check (status in ('new', 'read', 'answered', 'spam')),
  sender_fingerprint text,
  created_at timestamptz not null default now()
);

create index if not exists contact_messages_created_at_idx
  on public.contact_messages (created_at desc);

create index if not exists contact_messages_fingerprint_created_idx
  on public.contact_messages (sender_fingerprint, created_at desc);

-- A böngészőből érkező névtelen látogató nem olvashatja és nem írhatja
-- közvetlenül a táblát. A hozzáférést csak a szerveroldali Edge Function kapja.
alter table public.contact_messages enable row level security;
revoke all on table public.contact_messages from anon, authenticated;
grant all on table public.contact_messages to service_role;

comment on table public.contact_messages is
  'Attila Zenerádiója kapcsolatfelvételi űrlapjainak üzenetei. Hozzáférés kizárólag szerveroldali funkción keresztül.';
