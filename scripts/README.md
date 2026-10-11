# Ferramentas do repositório

Scripts são operações explícitas; a aplicação não os executa por abrir uma página de experimento. Usar os comandos abaixo a partir da raiz. Nenhum script manual pago faz parte de `npm test` ou `npm run build`.

## Verificações automatizadas

Os comandos abaixo não exigem inferência paga no modo padrão. As suítes live incluídas em `npm test` podem fazer chamadas quando `LIVE_OPENROUTER_KEY` ou `LIVE_ENV_FILE` estão configurados; deixar essas opções desativadas para a verificação simulada.

| Comando/arquivo | Efeito e saída |
| --- | --- |
| `npm run check:repo` — [check-repository.mjs](check-repository.mjs) | Lê documentação mantida/imports/config; falha em destinos ausentes, config raiz antiga ou fronteiras proibidas. Não verifica anchors Markdown, todos os ciclos ou código morto |
| `npm run check:bundle` — [audit-client-bundle.mjs](audit-client-bundle.mjs) | Compila em memória, mede fechamento transitivo inicial e recusa módulos pesados específicos. `--output caminho` salva JSON explicitamente |
| `npm run check:gateway` — [check-visual-gateway.mjs](check-visual-gateway.mjs) | `node --check` em `server/*.mjs`; sintaxe, sem provar integração |
| `npm test` / `npm run test:gateway` | Suítes cliente e Node; provedores/serviços simulados onde indicado |
| `npm run test:planning-quality` | Testa captura e limites do [laboratório de planos](../docs/design/plan-quality/README.md) com transporte roteirizado; não faz inferência paga |
| `npm run bench:planner` | CPU em árvores sintéticas de 100 a 12.000 nós, abertas/resolvidas; salva JSON em `.codex-audit-planning-performance`, falha se qualquer operação/invariante falhar. Não mede FPS nem carga de servidor |
| [pdf-performance/README.md](pdf-performance/README.md) | Bateria manual com PDFs sintéticos reais, componente compartilhado compilado e workers reais. Compara versões congeladas em origem local isolada; conta workers, cópias de bytes e raster retido. Não usa projetos/contas reais nem mede o transporte cifrado da nuvem |
| `npm run bench:gateway` / `npm run test:planner-load` | 11 cenários HTTP locais com rajadas de 20/50; handlers reais, autenticação/provedores/RPC simulados. Mede limites/isolamento/recuperação, sem chamadas externas ou prova de capacidade Railway/Supabase. O benchmark salva somente `gateway-load-latest.json` local; preserva a evidência datada |
| [test-vault-sql.mjs](test-vault-sql.mjs) | Postgres WASM isolado com fixtures fabricadas, runtime temporário PGlite 0.5.8. Ler instruções no cabeçalho; não instala dependência no projeto nem valida Supabase gerenciado |

## Geração de identidade

- `npm run icons` usa [generate-icons.mjs](generate-icons.mjs) para assets de identidade na raiz de `public`.
- `npm run icons:pwa` usa [pwa/generate-icons.mjs](pwa/generate-icons.mjs) para ícones dedicados em `public/pwa`.
- [generate-project-icon-ids.mjs](generate-project-icon-ids.mjs) atualiza somente os nomes pesquisáveis do catálogo de ícones; o catálogo SVG completo é carregado quando usado. Testes detectam diferenças contra a dependência instalada.

São geradores distintos, com saídas diferentes. Executá-los regrava os assets correspondentes; conferir o diff antes de versionar. A fonte do gerador PWA saiu de `src/pwa` porque é ferramenta de autoria, não runtime do cliente.

## Comparações manuais de IA

| Arquivo | Protocolo e efeitos |
| --- | --- |
| [compare-visual-models.ts](compare-visual-models.ts) | Comparação inicial com/sem guia; `--run` faz duas chamadas pagas e grava amostras. Recusa sobrescrever saídas existentes |
| [compare-visual-matrix.ts](compare-visual-matrix.ts) | `--prepare` prepara matriz; `--run` retoma células pendentes com chamadas pagas, lock e preservação das primeiras tentativas |
| [visual-matrix-runner.ts](visual-matrix-runner.ts) | Helpers de orçamento/coordenação/integridade usados pela matriz, não outro produto |
| [compare-audio-transcription.mjs](compare-audio-transcription.mjs) | Sem `--live` não chama APIs. Com `--live --fixtures manifest.json --env-file arquivo-privado --output novo.json`, faz até seis primeiras tentativas STT em áudio sintético, sem retries; recusa sobrescrever relatório |
| [generate-audio-fixtures.ps1](generate-audio-fixtures.ps1) | Gera três WAVs pt-BR localmente com Microsoft Maria Desktop no Windows, em pasta de auditoria ignorada; nenhuma voz do usuário |
| [planning-quality.mjs](planning-quality.mjs) | Padrão sem rede; `--live` executa o serviço real esboço→expansão→decomposição, com tetos de chamadas/custo e primeira tentativa preservada. Ler [protocolo](../docs/design/plan-quality/README.md) antes de executar |

Ler [proveniência da comparação](../docs/visual-modeling-skills.md) e [matriz](../docs/design/three-skills-comparison/matrix/README.md) antes de executar. As credenciais são lidas do ambiente local; não copiá-las para saídas, logs ou documentação. Guia de skill e referência de imagem/texto são fatores diferentes. Navegar pelas páginas salvas não gera novas amostras.
