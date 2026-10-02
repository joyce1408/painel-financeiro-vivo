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
| `js/classify.js` | Aplica, nesta ordem: regras do sistema, suas regras, histórico unânime. Se nada se aplica, o lançamento vai para pendências. |
| `js/importer.js` | Etapas: leitura, identificação, deduplicação, classificação, revisão, gravação e desfazer. |
| `js/calc.js` e `js/insights.js` | Todos os números e insights, calculados da base. |
| `js/views/` | Uma tela por arquivo. |

## Testes

| Script | O que testa |
|---|---|
| `tools/test-parsers.mjs` | Leitores contra os arquivos reais. |
| `tools/browser-pdfjs.mjs` | pdf.js no Chromium. |
| `tools/e2e.mjs` | Ponta a ponta: totais, reimportação, pendências, backup e celular. |
