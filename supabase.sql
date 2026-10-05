-- Painel Financeiro Vivo: sincronização entre aparelhos.
-- Rode UMA vez no SQL Editor do Supabase (projeto novo, só para o painel).
--
-- O que fica guardado aqui: um "cofre" por família, com
--   id     = código de 64 caracteres derivado da senha da família (não revela a senha)
--   dados  = bloco cifrado com AES-256-GCM no celular (ilegível sem a senha)
--   versao = contador usado para detectar gravações simultâneas
-- Não há nenhum dado financeiro, nome de aparelho, senha ou chave de criptografia em texto puro.
--
-- Acesso: ninguém lê ou escreve a tabela diretamente (RLS ligado, sem políticas, permissões revogadas).
-- A chave pública do app só consegue chamar as duas funções abaixo, e cada uma exige o id exato do cofre.
-- Não existem contas de usuário: quem não sabe a senha não sabe o id e não tem como achar o cofre.

-- (pode rodar de novo sem problema)
drop function if exists public.ler_cofre(text);
drop function if exists public.gravar_cofre(text, text, bigint, text);
drop function if exists public.gravar_cofre(text, text, bigint);

create table if not exists public.cofres (
  id             text primary key check (id ~ '^[0-9a-f]{64}$'),
  versao         bigint      not null default 0,
  dados          text        not null,
  atualizado_em  timestamptz not null default now()
);

alter table public.cofres enable row level security;
alter table public.cofres force row level security;
revoke all on table public.cofres from public, anon, authenticated;

create or replace function public.ler_cofre(p_id text)
returns table (versao bigint, dados text, atualizado_em timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select c.versao, c.dados, c.atualizado_em
  from public.cofres c
  where p_id ~ '^[0-9a-f]{64}$' and c.id = p_id;
$$;

-- Grava só se ninguém gravou no meio do caminho (versão esperada = versão atual).
-- Devolve a nova versão, ou -1 se outro aparelho gravou antes (o app lê de novo, junta e tenta outra vez).
create or replace function public.gravar_cofre(p_id text, p_dados text, p_versao_esperada bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v bigint;
begin
  if p_id !~ '^[0-9a-f]{64}$' then raise exception 'cofre inválido'; end if;
  if p_dados !~ '^v2z?\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+$' then raise exception 'conteúdo não está cifrado no formato do app'; end if;
  if length(p_dados) > 10000000 then raise exception 'dados grandes demais'; end if;
  select c.versao into v from public.cofres c where c.id = p_id for update;
  if not found then
    if p_versao_esperada <> 0 then return -1; end if;
    -- evita que alguém com a chave pública encha o projeto de cofres
    if (select count(*) from public.cofres) >= 3 then raise exception 'limite de cofres atingido'; end if;
    insert into public.cofres (id, versao, dados) values (p_id, 1, p_dados);
    return 1;
  end if;
  if v <> p_versao_esperada then return -1; end if;
  update public.cofres set versao = v + 1, dados = p_dados, atualizado_em = now() where id = p_id;
  return v + 1;
end;
$$;

revoke all on function public.ler_cofre(text) from public;
revoke all on function public.gravar_cofre(text, text, bigint) from public;
grant execute on function public.ler_cofre(text) to anon, authenticated;
grant execute on function public.gravar_cofre(text, text, bigint) to anon, authenticated;
