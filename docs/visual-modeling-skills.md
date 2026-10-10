# Guia de modelagem Three.js e amostra comparativa

Em 9 de outubro de 2026, a geração do estúdio passou a receber um guia adaptado das skills comunitárias [CloudAI-X/threejs-skills](https://github.com/CloudAI-X/threejs-skills): `threejs-fundamentals`, `threejs-geometry` e `threejs-materials`.

Os três `SKILL.md` originais estão em `.agents/skills/`, fixados no commit `b1c623076c661fc9b03dac19292e825a5d106823`, sem alterações. [Origem, hashes e declaração de licença](../.agents/skills/UPSTREAM.md) documentam esse snapshot. Essas cópias orientam o agente de desenvolvimento; a aplicação usa a adaptação própria, revisada e versionada em [modelingGuide.ts](../src/visuals/modelingGuide.ts).

## O que o agente da aplicação recebe

`buildVisualModelSystem(instruction)` combina as orientações revisadas com o guia atual `scene-v1-modeling-guide/2`. Ele explica primitivas, extrusões vazadas, perfis de revolução, tubos curvos e malhas personalizadas, além de escala, eixos, rotações, composição, conexões e cores consistentes. O texto da instrução seleciona, quando pertinente, uma receita fixa de ESP32 genérico, servo ou robô de dois braços. As receitas foram escritas para este projeto; não são exemplos literais das skills upstream nem modelos mecânicos certificados.

O fluxo real de [generation.ts](../src/visuals/generation.ts) usa esse guia antes de chamar o provedor BYOK. Notas, partes, anexos e metadados de fotografias continuam no campo de contexto como dados não confiáveis. Seus comandos não são interpolados nas instruções de sistema. A saída continua passando pela validação estrita `SceneV1` e pelos controles existentes de escopo, fontes atuais e aprovação/automático.

O aplicativo não executa os exemplos JavaScript das skills nem envia seus documentos inteiros ao modelo. Não há carregamento remoto das skills durante a geração. Uma atualização da base comunitária exige revisão da adaptação e de sua compatibilidade com o renderer.

## Amostra real: o mesmo ESP32 com e sem guia

Abra o [visualizador interativo](http://127.0.0.1:5190/docs/design/three-skills-comparison/) com o servidor local em execução. Seu [código](design/three-skills-comparison/index.html), [registro completo](design/three-skills-comparison/comparison.json), [cena sem guia](design/three-skills-comparison/baseline.json) e [cena com guia](design/three-skills-comparison/skills.json) ficam no repositório. A página exibe os resultados já salvos; abri-la ou girar os modelos não faz novas chamadas ao provedor.

Pedido idêntico:

> Crie uma representação 3D ilustrativa de uma placa de desenvolvimento ESP32, isolada e sem fundo, com seus componentes principais reconhecíveis. Não use medidas físicas exatas sem fonte.

Foram feitas duas chamadas reais via OpenRouter ao modelo `openai/gpt-6.1-sol`, uma por condição, com contexto vazio, raciocínio `medium`, limite de 10.000 tokens de saída e o mesmo schema. A temperatura foi omitida nas duas chamadas. A condição sem guia usa `BASELINE_VISUAL_SYSTEM`, preservado literalmente como o prompt anterior; a outra usa o guia `/1`, hoje preservado em `buildLegacyVisualModelSystem`, com o pedido acima. O registro inclui os dois prompts de sistema, consumo retornado pelo provedor e duração de cada chamada.

| Condição | Primitivas | Duração da chamada | Resposta |
|---|---:|---:|---|
| Sem guia de skills | 98 | 59,610 s | `stop`; cena válida |
| Com guia de skills | 49 | 32,814 s | `stop`; cena válida |

As primeiras respostas válidas foram preservadas sem retoques na geometria. Os dois objetos são reconhecíveis na conferência visual. Nesta amostra, a versão anterior contém mais detalhes, como a face do conector USB e as bases dos pinos; a versão guiada é mais compacta. A menor quantidade de primitivas e o tempo observado não demonstram melhor qualidade, precisão ou desempenho futuro.

O visualizador usa a função `modelItem` da aplicação, com as mesmas luzes, orientação inicial e regra de enquadramento para ambos. Cada conjunto é centralizado e ajustado à sua área de exibição. A grade pertence à página; os modelos são renderizados sobre superfície transparente. [Captura comparativa](design/three-skills-comparison/comparison.jpg).

Na conferência manual, **Girar 90°** alterou os dois modelos de forma sincronizada e **Restaurar vista** recuperou a orientação inicial. A interação em viewport móvel não foi exercitada nesta rodada.

Esta é uma amostra de inspeção, com um par de respostas, ordem sem guia → com guia, sem seed fixada, repetição, julgamento cego ou rubrica de qualidade. A intervenção combina princípios das skills com regras e receitas próprias da aplicação; não isola o efeito do conteúdo upstream. Não constitui avaliação científica do guia nem evidência física para o artigo.

## Comparação ampliada com referências

O [laboratório de referências](http://127.0.0.1:5190/docs/design/three-skills-comparison/matrix/) amplia a amostra com 32 primeiras tentativas: ESP32 e MG90S, quatro contextos (nenhuma referência, imagem, especificações e ambas), duas condições de guia e duas repetições. O [protocolo e resultado da rodada](design/three-skills-comparison/matrix/README.md) explicam entradas, orçamento, preservação de falhas e limitações. A amostra original acima permanece intacta.

Neste laboratório, os modos de imagem enviam **os pixels reais** por uma mensagem multimodal auditada. O CLI mantém seu protocolo independente. O aplicativo também oferece análise de pixels, ativada explicitamente no Estúdio 3D para refinamento e geração; o padrão continua sendo metadados textuais. O painel do laboratório mantém as referências visíveis, sincroniza as vistas e permite inspecionar os registros completos sem fazer novas chamadas.

## Limites da aplicação e verificação anterior

O contrato atual mantém as cinco primitivas e acrescenta **extrusão com furos, revolução, tubos e malhas de vértices/triângulos**. O padrão admite até 128 objetos; o avançado, até 96 por módulo e 512 no conjunto. Topologia e orçamento agregado são validados antes da renderização. As peças compartilham escala, envelopes e interfaces e podem ser inspecionadas montadas ou explodidas. O material permite apenas cor; roughness e metalness continuam fixados pelo renderer. Não há PBR configurável, texturas, cinemática ou certificação CAD. Pixels opcionais orientam aparência; não fornecem medidas calibradas nem comprovam compatibilidade física. [Contrato e limites atuais](design/advanced-model-generation.md).

Na rodada inicial de 09/10, `npm test` passou com 490 testes e 8 live ignorados; os 14 testes do gateway passaram; `npm run build` concluiu TypeScript e Vite com 530 módulos e código de saída 0. A cobertura nova verificava uso efetivo do guia na requisição, seleção de receita e separação entre instruções e referências. As duas amostras LLM acima foram executadas separadamente dos testes automatizados. A avaliação paga TypeSafe não foi executada nessa rodada.

A checagem TypeScript dedicada do gerador de amostras e do visualizador retornou zero diagnósticos. A busca pelo valor exato da chave OpenRouter em 30 arquivos textuais do build e da comparação não encontrou correspondências.

O [registro de validação visual](visual-canvas-validation.md) mantém a separação entre entrega inicial, integração de chat e esta rodada de modelagem.

## Produção `/2` e amostra modular — 10/10/2026

A matriz anterior permanece fixada em `/1`, inclusive no schema de cinco primitivas. Um teste reproduz os 32 prompts registrados, e `--prepare` valida as 32 células existentes sem novas chamadas. A liberdade geométrica de `/2` e o planejamento em módulos são outra intervenção, ainda sem comparação controlada de qualidade.

Uma chamada pelo fluxo completo do Estúdio gerou **69 objetos em três módulos**: 59 formas no microservo e acessórios, sete no suporte e três no elo. O conjunto usa **20 extrusões, nove perfis de revolução e três tubos**, além de 37 primitivas. [Montado e explodido](http://127.0.0.1:5190/docs/design/mg90s-advanced/) conserva a geometria exportada sem retoques. O TXT registra falha na leitura das fontes: zero documentos legíveis, dimensões e encaixes aproximados.

A validação final passou com **892 testes e oito externos ignorados**, build TypeScript/Vite com **571 módulos**. O motor tem [ensaios visuais independentes de IA](http://127.0.0.1:5190/docs/design/geometry-tests/). A amostra modular valida o fluxo, a separação reversível e a geometria suportada; não demonstra fidelidade física nem superioridade do guia.
