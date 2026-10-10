# Diagramas interativos no Dynamic Diary

Integração incremental de 10/10/2026. A decisão do laboratório foi incorporada ao canvas existente: documento declarativo validado → React/SVG. Código React/JavaScript gerado não é executado. Imagens e modelos Three.js continuam nos seus fluxos atuais.

## Uso

Abra o Estúdio pelo botão de cubo no canvas e escolha **Diagrama** no seletor de artefato. Use a mesma barra, `@`, arquivos e opção de análise de imagens. O nó selecionado é incluído como referência ao mudar para Diagrama. Gere e aplique a proposta; no modo automático, um resultado válido e atual é inserido diretamente. Recusar, minimizar durante a geração e remover do histórico usam os controles existentes.

O chat dispõe da ação `visual_action.generate_diagram` e respeita a mesma política de aprovação. Não exige outra tela nem endpoint de geração; utiliza o cliente/proxy de IA existente.

No canvas, arraste o desenho para movê-lo, redimensione pelas alças e conecte/desconecte seu vínculo opcional com um nó. Controles e elementos vinculados não iniciam o arrasto do canvas. Clicar numa forma vinculada seleciona o nó existente; Enter/Espaço também funcionam. O lápis contextual aceita ajustes com os mesmos anexos/referências e **OK** grava uma revisão do mesmo artefato. A ação de revisão anterior restaura documento e parâmetros. Cópia/colagem cria uma versão independente. Exportação/importação portáteis e persistência carregam documento, parâmetros, posição e revisões.

## Amostra de QA sem inferência

Importe [production-torque-example.json](./production-torque-example.json) pelo importador de planos existente **em um projeto de QA separado**. Caminho pela interface: Meus projetos → Começar um plano → criar projeto de QA com um objetivo → Ver demonstração → menu do plano → Importar JSON. `openPlanner` salva o plano anterior e troca o projeto dono antes da demonstração/importação; o arquivo passa a ser o plano do projeto de QA. O arquivo não contém mídia, chaves ou observações físicas. Nome: `QA · Diagrama de torque (sintético)`; identidade: `qa-diagram-torque-20261010`. O formato legado `cellproject-visual-plan` é preservado por compatibilidade.

1. Abra o mapa; o desenho está à direita dos três nós.
2. Carga de 0,2 kg e distância de 0,1 m exibem 0,196 N·m. Carga de 0,4 kg e distância de 0,2 m exibem 0,785 N·m, deslocando braço, carga e seta juntos.
3. Clique no eixo e na carga: selecionam, respectivamente, `Eixo · servo não especificado` e `Ensaio a planejar`.
4. Mova, redimensione e desvincule o artefato. Copie/cole e altere o slider da cópia: o original conserva seu valor.
5. Exporte/reimporte ou recarregue para conferir persistência. Nenhum nó deve avançar para confirmado/concluído.

Regenerar exatamente a amostra, sem rede: `node docs/design/interactive-artifacts/build-production-fixture.mjs`. O teste de integração importa esse arquivo pela fronteira portátil de produção.

## Contrato e limites

O domínio está em `src/visuals/diagram/`. Até seis parâmetros, 16 constantes, 16 cálculos em DAG ordenado, 100 formas e 60 bindings. Operações: produto, soma, diferença e quociente. Formas: retângulo, círculo, linha, path, polyline e texto. Diagramas estáticos podem não ter sliders. Não há URLs, scripts, HTML, imports, CSS ou handlers arbitrários no documento.

A validação exige geometria por tipo, bindings compatíveis e únicos, dependências existentes, números finitos e raio/tamanho não negativos. Intervalos conservadores verificam extremos dos parâmetros e impedem divisores que cruzem zero. Formas numéricas ficam no viewBox; paths/polylines têm sintaxe e coordenadas limitadas e são recortados pelo SVG, sem garantia de enquadramento completo de seus traços ou texto. A aritmética por intervalos pode recusar uma geometria válida quando variáveis são correlacionadas. Não se faz análise dimensional ou avaliação de interferência física.

IDs internos são simples e restritos; `nodeId` é uma identidade opaca do plano real, inclusive nanoids iniciados em número/hífen ou contendo maiúsculas. A geração e aplicação conferem pertencimento; importação/hidratação removem vínculos ausentes preservando desenho e layout. O contexto inclui índice limitado a 80 nós, com indicação de corte, além das referências explícitas. Não inclui o critério oculto da IA.

Geração faz uma inferência JSON textual com validação local e `maxRetries: 0`, evitando o transporte de tupla recusado no laboratório. Respostas inválidas falham sem reparo pago oculto. Mudança de projeto/contexto impede aplicação; mudanças no documento/parâmetros também impedem sobrescrita por uma revisão atrasada. Mover/redimensionar durante uma revisão é preservado.

Os parâmetros só modificam o artefato. Não escrevem critérios, resultados observados ou confirmações. A amostra usa carga pontual e braço horizontal, sem massa do braço, dinâmica, atrito ou capacidade nominal de servo. Software funcionando e valores coerentes com uma fórmula não comprovam fidelidade, segurança ou compatibilidade física, nem benefício de aprendizagem.

## Verificação

Testes determinísticos cobrem o contrato, interações DOM/teclado, proposta/aprovação/contexto obsoleto, revisão/undo, vínculos reais, remoção de vínculos ausentes, parâmetros independentes na cópia e portabilidade. Todas as inferências nos testes são mocks, sem API paga. Evidências do laboratório permanecem em `EVALUATION.md`; a integração não transforma os resultados limitados do ensaio em comparação conclusiva entre arquiteturas.

Checkpoint automatizado: `npx vitest run src/visuals src/ai/visualTools.test.ts` → 455 testes em 44 arquivos; `npm run lint` (TypeScript) → exit 0. QA humano/automatizado de navegador é registrado separadamente pelo responsável pela integração.
