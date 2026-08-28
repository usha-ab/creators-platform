-- Dokumentbiblioteket för uppläsaren (/app/lyssna).
--
-- Låg tidigare bara i webbläsarens localStorage, vilket betydde att ett
-- dokument man lade in i mobilen inte fanns på datorn. Här får biblioteket en
-- egen tabell så att det följer med mellan enheter. Texterna är personliga —
-- RLS begränsar varje rad till sin ägare, och det finns ingen policy som
-- släpper in någon annan.

create table if not exists public.listen_documents (
  -- Id:t sätts av klienten (crypto.randomUUID) så att samma dokument har samma
  -- id lokalt och på servern. Utan det går de inte att para ihop vid synk.
  id uuid primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  -- Taket motsvarar klientens MAX_DOCUMENT_CHARS. En bok på 500 000 tecken är
  -- ~25 timmars uppläsning; mer är inte ett dokument utan ett misstag.
  content text not null check (char_length(content) <= 500000),
  -- Textens längd som egen kolumn: bibliotekslistan visar längd, uppskattad
  -- tid och andel uppläst utan att behöva dra hem själva texten.
  content_length integer generated always as (char_length(content)) stored,
  source text not null default 'paste'
    check (source in ('paste', 'file', 'url', 'pdf', 'epub')),
  source_url text,
  -- Läspositionen som teckenindex i content.
  progress integer not null default 0 check (progress >= 0),
  created_at timestamptz default now() not null,
  -- Sätts av klienten vid varje ändring och avgör vem som vinner när samma
  -- dokument ändrats på två enheter.
  updated_at timestamptz default now() not null
);

-- Biblioteket listas alltid för en användare, nyast ändrat först.
create index if not exists idx_listen_documents_user
  on public.listen_documents(user_id, updated_at desc);

alter table public.listen_documents enable row level security;

create policy "Users can view own listen documents"
  on public.listen_documents for select
  using (auth.uid() = user_id);

create policy "Users can add own listen documents"
  on public.listen_documents for insert
  with check (auth.uid() = user_id);

create policy "Users can update own listen documents"
  on public.listen_documents for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can delete own listen documents"
  on public.listen_documents for delete
  using (auth.uid() = user_id);

comment on table public.listen_documents is 'Texter sparade i uppläsaren (/app/lyssna), synkade mellan användarens enheter';
