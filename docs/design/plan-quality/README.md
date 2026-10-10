# Bateria de qualidade do planejamento

Este laboratório executa **o serviço de produção** `outlinePlans → expandPlan → decomposeNode`. Não substitui os prompts, schemas, SDK, cliente ou normalizadores. Vite SSR apenas carrega os módulos TypeScript; `fake-indexeddb` isola a configuração e o idioma, sem ler projetos, chats ou IndexedDB do navegador do usuário. O transporte é instrumentado para guardar evidências. Os testes locais têm respostas HTTP roteirizadas e **não são evidência de qualidade de uma LLM**.

## Executar

```powershell
# Padrão sem chamadas de rede ou pagas: salva condições e formulário de revisão.
node scripts/planning-quality.mjs

# Testes do registrador e ensaio integrado com HTTP roteirizado.
npx vitest run --config docs/design/plan-quality/vitest.config.ts

# Piloto opt-in: 4 condições × 3 etapas, usando OPENROUTER do .env em memória.
node scripts/planning-quality.mjs --live --env-file 'C:/caminho/do/projeto/.env'

# Extrair uso/custo e verificações técnicas dos registros brutos, sem chamadas pagas.
node scripts/planning-quality.mjs --summarize 'docs/design/plan-quality/results/DIRETORIO_DA_EXECUCAO'
```

O modelo vem de `PROVIDER_DEFAULTS.openrouter.mainModel` em `src/config/store.ts`, salvo em um store isolado. Isso reproduz o default de uma instalação sem configuração; **não descobre a escolha persistida no navegador do usuário**. `--model ID` permite uma escolha explícita e a registra como override. Antes de qualquer POST pago, o executor consulta `https://openrouter.ai/api/v1/models`, exige o ID exato e suporte a saída estruturada. Não existe fallback silencioso.

`--output` deve apontar para diretório novo. `--cases` aceita IDs separados por vírgula. Os quatro IDs centrais são `new-no-reference`, `reverse-no-target`, `reverse-bounded-source` e `reverse-variant-conflict`. Os casos adicionais `robot-unspecified` e `arduino-and-cable` estão preparados; não entram no piloto central. Executá-los ao vivo requer outra execução explícita. `--max-requests` e `--max-usd` definem os tetos; os padrões são 12 e US$ 3.

As quatro condições têm o mesmo objetivo de patinete, idioma, regras vazias, modelo, política de seleção e parâmetros por etapa. Somente abordagem, alvo e contexto delimitado variam. Não é um desenho fatorial completo: criação nova com fonte não faz parte destas quatro células. A expansão usa o primeiro esboço de menor rank; a decomposição escolhe o primeiro recurso de energia/controle/placa por nome, ou o primeiro recurso. A escolha e o contexto efetivo ficam salvos. A comparação de decomposições exige cuidado porque os nós escolhidos podem ter funções diferentes.

## Evidências e limites de custo

`manifest.json` contém revisão Git, caminhos modificados, hash do diff, hashes dos módulos/pacote/harness, condições, fonte do modelo, catálogo público consultado, preços, opções comuns e contadores. `attempt-NN.json` guarda corpo exato da requisição e resposta textual JSON/SSE, status/erro, início/fim, tempo, SHA-256 e uso informado pelo provedor. Nenhum header é salvo. A chave em memória, padrões de credencial e campos sensíveis são redigidos. A primeira tentativa é preservada mesmo se o serviço recuperar apenas parte da resposta ou remover âncoras indevidas.

Cada POST atravessa um único limite instrumentado, incluindo eventual retry. O SDK recebe `maxRetries: 0` em todas as etapas. Antes de enviar, reserva-se custo de entrada pelo número de bytes UTF-8 do corpo mais 1024 tokens de margem e pelo teto completo de saída do `callOpts` de produção, usando a maior tarifa publicada entre as faixas. A reserva não é devolvida por falha ou uso menor. Trata-se de **estimativa conservadora de inferência**, não de garantia de cobrança; taxas externas ou alterações do provedor podem diferir. Custo ausente permanece `null`; não vira zero.

Arquivos `*-outline.json`, `*-expand.json` e `*-decompose.json` guardam saídas normalizadas, eventos de progresso (sem duplicar parciais), avisos, erros e tempo. `*-selection.json` e `*-decompose-input.json` registram a seleção. Uma falha não é substituída por resposta escrita à mão e não dispara nova tentativa automática. `review-template.json` começa com `not_evaluated`; testes/JSON válido/cobertura lexical não o aprovam.

`--summarize` escreve `technical-summary.json` como extração suplementar, sem alterar os arquivos originais. No primeiro piloto, comentários SSE de processamento revelaram uma falha no extrator de uso inicial; o texto terminal preservou tokens/custo e a extração suplementar explicita a correção. O extrator atual aceita esses comentários e preserva texto já recebido se o stream falhar.

## Fontes delimitadas

As [especificações globais](https://www.mi.com/global/product/xiaomi-electric-scooter-4/specs/) e a [descrição oficial](https://www.mi.com/global/product/xiaomi-electric-scooter-4/) foram reabertas em 10/10/2026. `planning-quality-cases.ts` contém paráfrases humanas delimitadas, IDs de documentos, URLs, variante e seções. Não são os arquivos integrais nem uma extração automática dos anexos. As declarações pertencem ao **Scooter 4 global**. O caso conflitante informa **4 Pro**, mantendo as fontes do Scooter 4.

A ficha informa 300 W nominais/600 W máximos, E-ABS com disco traseiro, pneus de 10 polegadas, bateria T2201-BA3A de 7650 mAh/275,4 Wh e adaptador de 1,7 A/42 VDC máximo. A descrição apresenta painel, dobra, BMS e condições do ensaio comercial de alcance. As páginas não documentam a BOM interna completa, pinagem do controlador, protocolo dos conectores ou compatibilidade de um patinete caseiro. O texto fornecido usa `sourceText`, o mesmo caminho de contexto delimitado dos anexos. Pesquisa web automática fica desligada para manter fontes e número de chamadas comparáveis. URLs em contexto não se tornam automaticamente âncoras `link`, pois a política de produção só permite links da pesquisa web.

## Revisão independente

Use [rubric.md](rubric.md), lendo as saídas reais e conferindo afirmações nas fontes. Registre caminho/campo e pequeno trecho que sustenta cada nota, além de contraprova. O autor do harness não deve decidir sozinho uma aprovação geral. A rubrica dá resultados separados; não há média que esconda um conflito de variante ou afirmação inventada.

Um piloto de uma tentativa por condição mede apenas aquelas respostas. Não demonstra eficácia, novidade, aprendizagem, segurança física ou que o patinete/robô foi construído. TypeSafe não foi executado e não constitui validação semântica. Este piloto não exercita replanejamento. Na revisão posterior, as instruções de pesquisa e replanejamento foram corrigidas para distinguir afirmações documentais de verificação e admitir causa indeterminada; essa mudança tem regressões de contrato, mas não foi avaliada por novas chamadas reais neste piloto. Ver [relatório integrado](../../reports/planning-quality-performance-2026-10-10.md).
