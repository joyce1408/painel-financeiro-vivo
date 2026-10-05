# Segurança da sincronização

Auditoria feita em 05/10/2026, antes de configurar o Supabase real. Os testes estão em `tools/sync-e2e.mjs`, com 38 verificações, e rodam contra `tools/mock-supabase.mjs`, que segue as mesmas regras do `supabase.sql`. O SQL também foi executado num PostgreSQL 16 real.

## O que sai do aparelho

Só três campos são enviados: `p_id`, `p_dados` e `p_versao_esperada`.

| Campo | O que é |
|---|---|
| `p_id` | 64 caracteres hex derivados da senha. |
| `p_dados` | O bloco cifrado. |
| `p_versao_esperada` | Um número. |

A senha, a chave, os nomes dos aparelhos e qualquer valor ou descrição nunca vão em texto puro. Isso foi verificado interceptando todas as requisições no teste.

## Criptografia

- **Derivação da senha.** PBKDF2-SHA256 com 600 mil iterações. O sal é o app mais o endereço do projeto. A saída tem 512 bits: a primeira metade vira a chave AES-256 e a segunda vira o id do cofre.
- **Onde a chave fica.** Ela é importada como CryptoKey não exportável e guardada só no IndexedDB do aparelho. A senha não é guardada.
- **Cifragem.** JSON, depois gzip, depois AES-256-GCM.
  - O IV é aleatório, tem 96 bits e é novo a cada gravação.
  - A tag tem 128 bits.
  - O AAD contém o id do cofre.
- **Proteção contra rollback.** Dentro do bloco cifrado vai `seq`, que é igual à versão do servidor. Se a nuvem devolver uma versão menor que a última já vista, a sincronização para. Se o bloco tiver sido adulterado, o AES-GCM recusa.

## Servidor (`supabase.sql`)

- A tabela `cofres` tem só `id`, `versao`, `dados` e `atualizado_em`.
- O RLS está ligado e forçado, sem nenhuma política, e as permissões de `anon` e `authenticated` foram revogadas. Por isso não há leitura nem escrita direta na tabela.
- O acesso é feito só por duas funções `security definer` com `search_path = ''`. Ambas exigem o id exato do cofre, com 64 caracteres hex. A gravação só aceita conteúdo no formato cifrado do app.
- Não existem contas de usuário. O isolamento vem do id secreto, que tem 256 bits e não pode ser adivinhado, somado à criptografia.
- Há um limite de 3 cofres por projeto, para que ninguém com a chave pública encha o banco.
- Uma gravação só acontece se a versão esperada for igual à versão atual (`select … for update`). Assim, gravações simultâneas são detectadas, o app lê de novo, junta as alterações e tenta outra vez.

## Chaves do Supabase

O app recusa chaves `sb_secret_…` e JWTs com role diferente de `anon`. A `service_role` não aparece no código.

## Mescla

- **Edições.** Cada registro mantém a versão alterada por último. O relógio nunca anda para trás em relação ao que já foi visto de outro aparelho.
- **Conflitos.** Quando os dois lados mudaram o mesmo registro desde a última sincronização, a versão descartada fica guardada em Sincronizar › Conflitos e pode ser restaurada.
- **Exclusões.** Ficam registradas para sempre na lixeira e vencem qualquer cópia ou edição feita por um aparelho que ainda não sabia da exclusão.
  - Recriar algo de propósito, como reimportar um arquivo, marca o registro com `_revive`.

## Proteções locais

- **Cópia automática** antes da 1ª sincronização, antes de restaurar um backup, antes de apagar tudo e antes de qualquer sincronização que remova registros. As 8 cópias mais recentes ficam só no aparelho.
- **Pausa por excesso de exclusões.** Se uma sincronização for apagar mais que o maior valor entre 10 registros e 5% dos lançamentos, ela pausa e pede confirmação.
- **Content-Security-Policy.** Só permite scripts do próprio site e conexões com o próprio site e com `*.supabase.co`.

## Limitações conhecidas

- **Metadados visíveis ao servidor.** O servidor vê o tamanho do cofre, quantas vezes foi gravado e quando.
- **Aparelho desbloqueado.** Quem tiver o aparelho desbloqueado com o painel aberto vê os dados. O app não tem senha própria de abertura.
- **Senha esquecida.** A cópia da nuvem fica irrecuperável, mas os aparelhos continuam com os dados.
- **Senha fraca.** Se alguém obtiver o bloco cifrado, poderá tentar adivinhar a senha offline. As 600 mil iterações tornam cada tentativa cara, mas use 3 ou 4 palavras.
- **Supabase real.** Ainda não foi testado contra o Supabase real.
