-- Painel Financeiro Vivo: sincronização entre aparelhos (rode uma vez no SQL Editor do Supabase).
-- A nuvem guarda só um "cofre" criptografado: os dados são cifrados no celular (AES-256-GCM)
-- com a senha da família antes de sair do aparelho. O Supabase nunca vê os números.

create table if not exists public.cofres (
  id             text primary key check (length(id) >= 32),
  versao         bigint      not null default 0,
  dados          text        not null,
  atualizado_em  timestamptz not null default now(),
  atualizado_por text
);

-- Ninguém acessa a tabela diretamente: só pelas duas funções abaixo, e só quem sabe o id do cofre.
alter table public.cofres enable row level security;
revoke all on table public.cofres from anon, authenticated;

create or replace function public.ler_cofre(p_id text)
returns table (versao bigint, dados text, atualizado_em timestamptz, atualizado_por text)
language sql
security definer
set search_path = public
as $$
  select c.versao, c.dados, c.atualizado_em, c.atualizado_por
  from public.cofres c
  where c.id = p_id and length(p_id) >= 32;
$$;

-- Grava só se ninguém gravou no meio do caminho (versão esperada). Devolve a nova versão, ou -1 se houve conflito.
create or replace function public.gravar_cofre(p_id text, p_dados text, p_versao_esperada bigint, p_por text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v bigint;
begin
  if length(p_id) < 32 then raise exception 'cofre inválido'; end if;
  if length(p_dados) > 15000000 then raise exception 'dados grandes demais'; end if;
  select c.versao into v from public.cofres c where c.id = p_id for update;
  if not found then
    if p_versao_esperada <> 0 then return -1; end if;
    insert into public.cofres (id, versao, dados, atualizado_por) values (p_id, 1, p_dados, left(p_por, 60));
    return 1;
  end if;
  if v <> p_versao_esperada then return -1; end if;
  update public.cofres
     set versao = v + 1, dados = p_dados, atualizado_em = now(), atualizado_por = left(p_por, 60)
   where id = p_id;
  return v + 1;
end;
$$;

revoke all on function public.ler_cofre(text) from public;
revoke all on function public.gravar_cofre(text, text, bigint, text) from public;
grant execute on function public.ler_cofre(text) to anon, authenticated;
grant execute on function public.gravar_cofre(text, text, bigint, text) to anon, authenticated;
