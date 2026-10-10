# Preparação da publicação — 10/10/2026

## Escopo autorizado

Integração na `main` e publicação do Dynamic Board, notas visuais e tinta livre, abas e janelas do estúdio do plano, sincronização dos desenhos, ícones/aparência de projetos, contraste dos diagramas e organização do repositório/documentação. A base remota verificada foi `ab793fd7328e35057c97efb46f282cacdeabc3d9`.

O fluxo de acesso por senha e aparelho autorizado acompanha a integração: já estava no snapshot publicado anteriormente e precisa permanecer compatível. Esta rodada não apaga contas, documentos, cofres ou chaves. Dairo e a expansão para novas áreas do conhecimento continuam propostas, descritas nas fichas dos módulos.

## Revisão e correções

Três revisores independentes examinaram plataforma/cloud, visuais e workspace. Nenhum P0/P1 foi identificado. Os problemas concretos encontrados receberam correção antes da integração:

- O relay SSE confundia `write(false)` com falha de conexão. Agora aguarda `drain`, com limite de cinco segundos, e evita acumular prévias enquanto há contrapressão. O teste HTTP verifica dois traços grandes consecutivos em conexões autenticadas, sem entrega a outra conta.
- O worker registrado em `/service-worker.js` recebia cache de uma hora. A resposta agora usa `no-cache`, assim como o caminho legado `/sw.js`.
- A imagem enviada como base ao estúdio entrava só na aba temporária. O último rascunho passa a ser persistido pelo mesmo callback de edição e sobrevive à saída e reabertura do canvas.

Cada regressão foi observada falhando antes da correção e passando depois. A organização documental preserva relatórios anteriores e separa implementação, experimento e proposta.

## Verificações executadas

| Verificação | Resultado |
| --- | --- |
| `npm test -- --maxWorkers=2` | 1.465 passaram; 8 testes de provedores externos ignorados; 163 arquivos passaram |
| `npm run test:gateway` | 162 passaram; nenhuma falha ou teste ignorado |
| `node scripts/test-password-access-sql.mjs <runtime-pglite>` | 11 verificações passaram em PostgreSQL WASM com fixtures de Auth/Storage |
| `npm run build` | TypeScript e Vite passaram |
| `npm run check:bundle` | Passou; nenhum módulo de feature carregado antecipadamente segundo o contrato do verificador |
| `npm run check:repo` | Executado após a atualização documental; verificar saída do comando para contagem atual |
| Inspeção de segredos e `git diff --check` | Sem valores de credenciais na alteração preparada; arquivos de ambiente e evidências locais permanecem ignorados |

O build conserva avisos de chunks acima de 500 kB e da base Browserslist antiga. O grafo inicial da aplicação mede cerca de 2,56 MB sem compressão / 763 kB gzip; esta revisão não afirma que o custo de carregamento foi eliminado.

## Inspeção de interface

No navegador local, foram conferidos Board e notas a 390 × 844, incluindo cinco instrumentos, tinta sobre texto, agrupamento de projetos e controles compactos. A largura do documento do Board permaneceu em 390 px. Em 1440 × 960, foram abertas três abas do estúdio e destacada uma delas em uma segunda janela; o diagrama sintético foi enquadrado no canvas e apresentou texto legível no tema escuro.

Capturas e logs completos desta execução ficam em `.codex-audit-release-2026-10-10/`, ignorado pelo Git. São evidências locais, sem dados ou credenciais de produção.

## Infraestrutura e limites

Antes da publicação, o Railway confirmou o serviço `cellproject-builder` no projeto `externo`, ambiente `production`, com uma réplica. `/healthz` respondeu 200. A configuração pública confirmou nuvem, senha, cofre e relay disponíveis. A presença das chaves OpenRouter/TypeSafe foi verificada sem exibir seus valores.

O conector P&D confirmou as migrações cloud/cofre e `20261010163258_dynamic_diary_password_access` no projeto Supabase configurado. Board, notas e traços usam os documentos existentes; não há nova migração de domínio nesta publicação. Prévia SSE é efêmera; persistência usa revisão de documento e conflitos explícitos.

Esta rodada não realizou um novo login real, um ensaio simultâneo em tablet e computador físicos ou chamadas pagas de geração/pesquisa. Os testes automatizados de relay e integração cliente não substituem essa avaliação com aparelhos reais. Instalação PWA, qualidade mecânica dos modelos e eficácia pedagógica também não são comprovadas por este release.

O resultado do deploy deve ser conferido pelo estado do Railway, saúde HTTP e identidade dos assets servidos; upload aceito não significa publicação saudável. O histórico de commits e deployments registra a revisão efetivamente publicada.
