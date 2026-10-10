# Laboratório de referências e guia Three.js

Experimento local de 9 de outubro de 2026. Abra o [laboratório](http://127.0.0.1:5190/docs/design/three-skills-comparison/matrix/) com o servidor Vite em execução. A página lê resultados salvos; suas interações não geram chamadas pagas.

## Desenho da comparação

São **32 primeiras tentativas**, sem retoques ou repetição seletiva:

| Variável | Condições |
|---|---|
| Objeto | ESP32-DevKitC V4 com WROOM-32E; TowerPro MG90S |
| Referência | Nenhuma; imagem; especificações; imagem + especificações |
| Instruções | Prompt anterior; prompt com guia adaptado de skills |
| Repetição | Duas por combinação |

O pedido de cada objeto permanece idêntico. Os dois lados de cada par recebem as mesmas evidências, o mesmo modelo `openai/gpt-6.1-sol` via OpenRouter, raciocínio `medium`, limite de 10.000 tokens de saída e contrato `SceneV1`. Temperatura e seed são omitidas. A ordem das condições é invertida entre repetições. Há até duas chamadas simultâneas; o tempo registrado inclui a influência dessa concorrência.

**Imagem significa pixels reais.** O CLI envia os bytes locais como parte multimodal e confere o SHA-256 depois da transformação do SDK, imediatamente antes da requisição. Nos modos sem imagem, a mesma auditoria recusa partes de imagem. O nome do arquivo, a URL de origem e os dados das outras condições não entram no pedido ao modelo. Somente os modos com especificações recebem seu texto.

O prompt anterior continha a frase de produção que informa ausência de análise dos pixels. Exclusivamente neste experimento, a frase é removida dos dois lados e substituída pelo mesmo protocolo de evidências. O aplicativo continua usando referências de imagem como metadados textuais; este laboratório não altera seu fluxo de geração.

A intervenção combina princípios das três skills comunitárias fixadas no commit `b1c623076c661fc9b03dac19292e825a5d106823` com regras do renderer e receitas próprias. Portanto, o experimento mede o **guia adaptado completo**, não o efeito isolado do texto upstream. [Proveniência](../../../../.agents/skills/UPSTREAM.md).

Há uma diferença entre os objetos no comportamento atual do seletor de receitas: o pedido de ESP32 ativa sua receita; o pedido escrito como “microservo MG90S” recebe o guia geral, mas não a receita acionada pela palavra isolada “servo”. As entradas foram preservadas e essa diferença deve ser considerada na análise entre objetos.

## Referências e observação

[cases.json](../fixtures/cases.json) preserva pedidos, especificações, critérios humanos, fontes, direitos, dimensões e hashes dos arquivos. As imagens são referências oficiais dos fabricantes, com atribuição e direitos reservados. O ESP32 tem uma ilustração pequena em vista superior, que não informa altura. A página do MG90S publica medidas divergentes, explicitadas no texto enviado. Não há remoção de fundo nem edição dessas entradas.

O painel mostra exatamente a referência da condição selecionada, duas cenas com rotação sincronizada, repetições, tabela de resultados, prompts e downloads JSON. Usa `modelItem` da aplicação, com as mesmas luzes, materiais e regra de enquadramento. O enquadramento ajusta cada resultado individualmente: a imagem exibida não permite comparar escala absoluta entre cenas.

Observe reconhecimento do objeto, disposição das peças, proporções, conexões, aderência às evidências disponíveis e afirmações sem suporte. Tempo, custo e contagem de primitivas são dados descritivos, **não notas de qualidade**. Nenhum vencedor é atribuído automaticamente. Duas repetições são um piloto; não demonstram superioridade estatística, precisão CAD, encaixe, funcionamento ou evidência física para o artigo.

## Execução e preservação

```powershell
# Apenas prepara/valida a matriz; nenhuma inferência.
npx vite-node --mode test scripts/compare-visual-matrix.ts --prepare

# Faz chamadas pagas somente para células ainda pendentes.
npx vite-node --mode test scripts/compare-visual-matrix.ts --run
```

O CLI lê `OPENROUTER` do ambiente local sem imprimir a chave. `maxRetries=0`; cada chamada tem 180 segundos de prazo. Respostas truncadas, erros e cenas inválidas são resultados finais, preservados sem nova tentativa. Um estado interrompido também não é repetido. Não execute o comando para substituir resultados: arquivos finais são exclusivos e imutáveis pelo runner.

`manifest.json` reúne protocolo, entradas, prompts, hashes e os 32 estados. `runs/{id}.json` preserva cada resultado final com cena validada quando disponível, texto original retornado, término, duração, consumo e ID de resposta. Nenhuma cena substituta preenche falhas. A ausência de custo reportado permanece `null`.

O controle de despacho usa orçamento de US$4 e reserva conservadora de US$0,25 por chamada em andamento ou sem custo reportado. Ele impede novas chamadas quando o saldo reservado é insuficiente; não é um limite de faturamento configurado no provedor. Resultados anteriores são retomados sem repetir chamadas finalizadas.

A primeira pré-execução foi barrada localmente pela auditoria, antes de qualquer envio remoto, por uma incompatibilidade com a serialização de `system.content` no SDK. O [registro integral do bloqueio](preflight-audit-failure-20261009/README.md) foi separado e preservado. Essa pré-execução não produziu respostas de modelo; a matriz principal começa após a correção validada com transporte simulado.

## Resultado desta rodada

O experimento `three-skills-matrix-v2` concluiu **32 chamadas / 32 cenas válidas**, sem falhas, truncamentos, chamadas ignoradas pelo orçamento ou custos desconhecidos. Custo reportado pelo provedor: **US$1,3180004**. Duração média das chamadas: 45,110 s, descritiva e sujeita à concorrência. As 32 primeiras respostas foram preservadas sem reparo, edição dos objetos ou repetição de inferência.

Quantidade de primitivas por repetição — não é uma nota de qualidade:

| Objeto | Referência | Sem guia: 1 / 2 | Com guia: 1 / 2 | Custo das quatro chamadas (US$) |
|---|---|---:|---:|---:|
| ESP32 | Nenhuma | 76 / 91 | 66 / 69 | 0,1933598 |
| ESP32 | Imagem | 106 / 86 | 77 / 80 | 0,2299780 |
| ESP32 | Especificações | 93 / 96 | 78 / 75 | 0,2130054 |
| ESP32 | Ambas | 99 / 87 | 86 / 86 | 0,2208184 |
| MG90S | Nenhuma | 36 / 28 | 40 / 45 | 0,1099926 |
| MG90S | Imagem | 44 / 44 | 50 / 42 | 0,1239154 |
| MG90S | Especificações | 30 / 30 | 23 / 28 | 0,1047890 |
| MG90S | Ambas | 45 / 39 | 33 / 38 | 0,1221418 |

### Observações desta amostra

- **MG90S e acessórios:** os quatro resultados sem referências têm um braço instalado. Nos 12 resultados com imagem, especificações ou ambas, o braço não aparece; isso corresponde à foto escolhida e ao pedido explícito das especificações. [Sem referência, repetição 1](screenshots/mg90s-none-1.png) · [com foto, repetição 1](screenshots/mg90s-image-1.png).
- **ESP32 e contagem de contatos:** imagem isolada não garantiu a contagem. Na repetição 1, o baseline contém 15 pinos por fileira; o guia, 19. Na repetição 2, o baseline representa 19 contatos superiores por fileira como toros, sem pinos verticais abaixo da placa; o guia contém 11 pinos por fileira e declara a disposição simplificada. A ilustração oficial mostra a vista superior, não a altura dos pinos. Inspecione os JSONs antes de comparar apenas a aparência.
- **ESP32 e especificações:** todos os oito resultados com especificações, isoladas ou junto à imagem, têm PCB nominal de 48,26 × 27,94, duas fileiras de 19 contatos e passo de 2,54. Os dois lados seguiram essas informações. As espessuras de 0,8 a 1,2 continuam escolhas ilustrativas, pois não foram fornecidas.
- **MG90S e dimensões:** os oito resultados com especificações preservam X = 22,8 e Z = 12,2 no corpo principal e eixo vertical deslocado. As alturas parciais variam; não constituem conferência dimensional do produto nem resolvem a divergência do fabricante.
- **Variação da geometria:** o cabo do MG90S com guia e foto apresenta trechos desconectados na repetição 1, mas não na repetição 2. Esse problema não deve ser generalizado ao guia com base em uma saída. [Repetição 1](screenshots/mg90s-image-1.png) · [repetição 2](screenshots/mg90s-image-2.png).

O guia tende a simplificar o ESP32 neste conjunto, mas há mudanças de detalhe e aderência nas duas condições. Os dados não sustentam um vencedor geral. As referências ajudam a tornar premissas observáveis e comparáveis; o experimento ainda não demonstra aprendizagem do usuário ou validação física.

### Verificação da entrega

- `npm test`: 517 testes passaram; oito testes live ignorados.
- `npm run test:gateway`: 14 testes passaram.
- `npm run build`: TypeScript e Vite concluídos, 533 módulos, saída 0.
- TypeScript dedicado do CLI, helper e viewer: zero diagnósticos.
- `--prepare` após a execução: 32 células validadas, zero pendentes, sem inferência.
- Todos os 32 arquivos individuais correspondem integralmente ao manifesto; 16 entradas têm imagem, 16 não; oito por contexto; lock removido ao finalizar.
- Navegador: os 16 pares / 32 modelos renderizaram; 32 downloads retornaram o ID e a cena correspondentes; rotação sincronizada e restauração verificadas; console sem erros.
- Viewport de 390 px: modelos em uma coluna, seletores funcionais e tabela com rolagem própria, sem transbordamento da página; tamanho padrão restaurado. Arraste por toque não foi exercitado manualmente.
- Busca por valores secretos configurados em 91 arquivos textuais do build e da comparação: zero correspondências.

A primeira amostra de duas gerações está preservada na [página anterior](../). Os custos acima pertencem somente à matriz nova.
