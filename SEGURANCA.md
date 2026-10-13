# Segurança do Painel Financeiro Vivo

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


## Senha de abertura e criptografia local (12/10/2026)

São três camadas, com funções diferentes:

| Camada | Protege | Não protege |
|---|---|---|
| **Bloqueio da tela** | Quem pegar o celular não vê nada sem a senha. A tela é coberta quando o app sai da frente (lista de apps recentes). | Não impede apagar o app ou os dados do Safari. |
| **Criptografia local** | Tudo o que está guardado no aparelho (lançamentos, faturas, regras, histórico, cópias de segurança, conflitos, configuração e chave da sincronização) é cifrado com AES-256-GCM. As chaves dos registros são HMAC-SHA256, porque algumas contêm data e valor. Sem a senha ou o código de recuperação, a base é ilegível. | Com o painel desbloqueado, os dados estão decifrados na memória. Alguém com controle técnico do aparelho desbloqueado e do navegador, naquele momento, pode lê-los. |
| **Sincronização** | O que vai para o Supabase é cifrado com a senha da família, que é outra senha. | É independente da senha de abertura. |

### Chaves

- **Chaves dos dados.** Há duas chaves aleatórias, uma para AES e outra para HMAC. Elas ficam "embrulhadas", ou seja, cifradas:
  - pela senha de abertura, com PBKDF2-SHA256 de 600 mil iterações e sal aleatório;
  - pelo código de recuperação, com 20 caracteres (cerca de 100 bits) e 200 mil iterações.
- **Senha e código.** Nunca são guardados nem enviados.
- **Na memória.** Com o painel bloqueado, as chaves não ficam na memória. O próprio código do app não consegue ler nem gravar nada até a senha ser digitada.

### Bloqueio

- **Fechar ou recarregar:** sempre volta bloqueado, porque as chaves só existem na memória.
- **App em segundo plano:** bloqueia ao voltar, conforme o tempo escolhido em Segurança (imediatamente, 1, 5 ou 15 min).
- **Sem uso:** bloqueia depois de alguns minutos com o app aberto e parado.
- **Fotos e arquivos:** enquanto a galeria ou a câmera estão abertas, o bloqueio espera até 10 minutos.
- **Botão 🔒 Bloquear:** bloqueia na hora.
- **Senha errada:** nunca apaga nada. Depois de 5 erros seguidos, é preciso esperar 30 s, depois 1 min, 2 min, e assim por diante até 15 min.

### Esqueci a senha

- **Com o código de recuperação:** o código abre as chaves e você define uma senha nova. Os dados não mudam.
- **Sem senha e sem código:** os dados deste aparelho ficam inacessíveis, por desenho. A tela explica como recuperar pela sincronização (senha da família), por um backup ou pelo outro celular. "Recomeçar" só apaga a base deste aparelho depois de você digitar APAGAR. Nada é apagado automaticamente.

### Migração da base antiga

1. Na primeira vez, a base sem proteção é lida.
2. Ela é cifrada e gravada numa base nova.
3. A base nova é conferida registro a registro (assinatura de cada loja).
4. Só depois disso a base antiga é removida.

Se a conferência falhar, a base antiga fica intacta. A chave da sincronização não pode ser copiada, então a sincronização pede a senha da família uma vez.

### Backup

O arquivo de backup sai cifrado (AES-256-GCM, PBKDF2 com 600 mil iterações) com uma senha escolhida na hora. Restaurar pede essa senha. Backups antigos sem proteção e o arquivo de dados validados continuam aceitos.

## Fatura por foto

- **De onde vem a foto.** Galeria, câmera, botão "Colar texto" (Texto ao Vivo do iPhone) ou PDF escaneado (as páginas viram imagem com o pdf.js local).
- **Imagem.** É aberta e tratada só na memória: rotação, tamanho, contraste e inversão de telas escuras. Não é guardada nem sincronizada.
- **Leitor de texto (OCR).** É o Tesseract.js 5.1.1.
  - Só é baixado de `cdn.jsdelivr.net` depois de você confirmar, e só na primeira vez (cerca de 5,5 MB).
  - O arquivo principal tem SHA-256 conferido pelo navegador (SRI).
  - A política de segurança só permite os caminhos dessa versão fixa.
  - A foto nunca é enviada: o reconhecimento roda num Web Worker do navegador.
- **Sem internet.** O service worker guarda o leitor depois do primeiro uso. Isso não foi comprovado no iPhone.
- **Revisão.** Todo lançamento lido passa por uma revisão editável.
  - Campos ilegíveis ficam vazios e marcados. Nada é inventado.
  - Possíveis duplicatas ficam desmarcadas: mesma conta, mesmo valor, mesma data ou até 6 dias de diferença.
  - Linhas repetidas entre fotos entram uma vez.
  - O pagamento da fatura não vira gasto.
  - A fatura é a do vencimento, não a da data de cada compra.
- **Importação.** Depois da revisão, entra na mesma importação dos arquivos: impressão digital, regras, pendências, histórico e desfazer. Se depois chegar o PDF da mesma fatura, os lançamentos que vieram por foto são reconhecidos e não duplicam.

## Dados reais fora do repositório

Testes que usam os dados reais (totais validados, arquivos do banco) ficam em `tools/local/`, que não vai para o GitHub. Os testes publicados usam faturas fictícias geradas na hora (`tools/ocr-fixtures.mjs`) ou comparam o painel consigo mesmo.
