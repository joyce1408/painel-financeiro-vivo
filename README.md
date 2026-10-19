# Painel Financeiro Vivo

Projeto separado do “Finanças Fácil”. É um app web (PWA) que roda no navegador. Os dados ficam só no aparelho, no IndexedDB, e nada é enviado para servidor.

## Como abrir

Os módulos JavaScript não funcionam abrindo o `index.html` direto do disco (`file://`). Há duas formas de abrir:

1. **No computador.** Na pasta do projeto, rode `python3 -m http.server 8000` e abra http://localhost:8000.
   - Se existir `data/seed.json` na pasta, a primeira abertura já carrega os dados validados de jan–ago/2026.
2. **No iPhone e em qualquer lugar.** Publique a pasta no GitHub Pages.
   - **Não publique a pasta `data/`.** Ela contém seus dados, e o `.gitignore` já a exclui.
   - Abra o site no Safari e use Compartilhar › Adicionar à Tela de Início.
   - No primeiro uso, toque em “Carregar dados validados” e escolha o arquivo `painel-dados-validados.json`.

Cada aparelho tem a própria base. Para passar dados de um aparelho para outro, use Backup › Baixar backup em um e Backup › Restaurar no outro.

## Senha de abertura

No primeiro acesso, o painel pede uma senha de abertura e mostra um código de recuperação. A partir daí:

- Tudo o que fica no aparelho é cifrado (AES-256-GCM).
- O painel abre só com a senha.
- O painel bloqueia ao fechar, ao recarregar, ao sair do app (no tempo escolhido em **Segurança**) e no botão 🔒.

Detalhes e limites estão em `SEGURANCA.md`.

## Fatura por foto

Em **Importar** há três caminhos:

- **📷 Tirar foto** abre a câmera.
- **🖼 Escolher da galeria** aceita várias fotos.
- **Colar texto** usa o Texto ao Vivo do iPhone.

O painel lê a foto no aparelho (Tesseract.js, baixado uma vez com seu consentimento) e mostra cada lançamento para você conferir e corrigir. Depois disso, a foto passa pela mesma importação dos arquivos. PDF escaneado também pode ser lido por esse caminho.

## Sincronizar entre aparelhos (opcional)

Para duas pessoas acompanharem o mesmo painel. Os dados são cifrados no aparelho (AES-256-GCM, chave derivada da senha da família com PBKDF2-SHA256, 600 mil iterações) antes de ir para o Supabase. A nuvem guarda só um "cofre" ilegível; a senha nunca é salva nem enviada.

1. Crie um projeto grátis em supabase.com.
2. SQL Editor › cole `supabase.sql` › Run.
3. No painel: Sincronizar › cole o Project URL e a chave anon/publishable › senha da família › Criar sincronização.
4. Copiar convite › envie para o outro celular › ele abre, digita a senha e toca em Entrar.

Cada aparelho continua com a base completa e funciona sem internet. Alterações em registros diferentes se juntam; no mesmo registro vale a mais recente. Se a senha for esquecida, a cópia da nuvem não pode ser aberta (os aparelhos continuam com os dados). No plano grátis o Supabase pode pausar projetos parados; é só reativar no site.

## O que lê

| Banco | Formato |
|---|---|
| Banco do Brasil | Extrato de conta corrente em CSV ou PDF |
| Nubank | Fatura do cartão em PDF |

A leitura de PDF usa o pdf.js (Mozilla, Apache 2.0). Ele vem incluído em `vendor/pdfjs`, então não depende de CDN e funciona offline.

O que **não** lê:

- Cartão Porto: só existem prints, e imagens não são lidas.
- Outros bancos, e arquivos OFX ou Excel.

Para um banco novo, mande um arquivo de exemplo para o Claude. Ele escreve `js/parsers/<banco>.js` com `detectar`, `lerCSV` e/ou `lerPDF`, e registra o leitor em `js/parsers/index.js`.

## Estrutura

| Arquivo | Função |
|---|---|
| `js/db.js` | Banco local (IndexedDB). Guarda contas, faturas, transações, categorias, regras, importações, arquivos e origens. |
| `js/parsers/` | Leitores dos arquivos. Cada leitor confere o próprio documento: saldo inicial + lançamentos = saldo final; soma da fatura = total da fatura. |
| `js/fingerprint.js` | Impressão digital `conta\|cartão\|data\|centavos\|ordem`, que evita duplicatas. |
| `js/classify.js` | Aplica, nesta ordem: suas regras fixas, regras gerais do sistema, suas outras regras, histórico unânime. Se nada se aplica, o lançamento vai para pendências. Regras que usam nomes, contas ou cartões pessoais não ficam no código: são regras fixas guardadas nos dados (cifrados) e entram por Categorias › Importar regras. |
| `js/importer.js` | Etapas: leitura, identificação, deduplicação, classificação, revisão, gravação e desfazer. |
| `js/calc.js` e `js/insights.js` | Todos os números e insights, calculados da base. |
| `js/protecao.js`, `js/trava.js` | Senha de abertura, chaves, bloqueio e recuperação. |
| `js/ocr.js`, `js/parsers/texto-fatura.js`, `js/views/foto.js` | Fatura por foto: imagem, OCR, leitura do texto e revisão. |
| `js/views/` | Uma tela por arquivo. |

## Testes

| Script | O que testa |
|---|---|
| `tools/trava-e2e.mjs` | Senha de abertura, bloqueio, recuperação, migração e criptografia local. |
| `tools/sync-e2e.mjs` + `tools/mock-supabase.mjs` | Sincronização (auditoria em `SEGURANCA.md`). |
| `tools/ocr-fixtures.mjs`, `tools/ocr-test.mjs`, `tools/foto-e2e.mjs` | Fatura por foto, com faturas fictícias. |
| `tools/regras-e2e.mjs` | Regras fixas guardadas nos dados (não no código): ordem, condições, importar regras, cifradas no aparelho. Só dados fictícios. |
| `tools/generico-e2e.mjs` | Banco sem leitor próprio: CSV (inclusive o do app do Nubank), OFX e PDF com texto passam pela conferência antes de importar. Só arquivos fictícios. |
| `tools/local/` (não publicado) | Leitores e ponta a ponta com os seus arquivos e totais reais. |

## Dados pessoais fora do repositório

Este repositório é público. Nele não entram dados financeiros, nomes, contas, cartões, extratos, faturas, fotos nem regras pessoais.

- Os dados ficam só no aparelho (IndexedDB cifrado) e, se você ligar a sincronização, num cofre cifrado no Supabase.
- As regras que dependem de nomes, contas ou cartões seus são **regras fixas** guardadas nos dados. Para levá-las a um aparelho, use **Categorias › Importar regras** com o seu arquivo de regras (guardado fora do repositório). A sincronização leva as regras aos outros aparelhos.
- Testes com dados reais ficam em `tools/local/`, que o `.gitignore` exclui. Os testes publicados usam só dados fictícios.
- O `.gitignore` também exclui `data/`, backups (`*.json`/`*.json.bak` de dados), extratos, faturas, fotos e chaves (`.env`).
