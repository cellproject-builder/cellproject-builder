# Estúdio 3D avançado · validação de 10/10/2026

O aviso genérico `visualAssemblyInvalid` misturava falhas de referências, planejamento, geometria, orçamento e contatos. O fluxo agora identifica a etapa e, quando aplicável, o módulo, mantendo a aplicação atômica da proposta e o cancelamento das próximas chamadas.

## Correções verificadas

| Caso | Comportamento anterior | Comportamento verificado |
| --- | --- | --- |
| Esfera ou cilindro girado em torno do próprio eixo | A caixa envolvente também girava e crescia, rejeitando peças que cabiam no módulo | Limites calculados a partir dos vértices usados pelo renderer |
| Cone, anel, superfície de revolução ou malha customizada rotacionada | Cantos inexistentes da caixa podiam exceder o envelope | Vértices transformados com a mesma escala, posição e rotação XYZ do Three.js |
| Referências do planejamento | O formato aceito pelo provedor permitia IDs arbitrários; a rejeição ocorria depois da resposta | IDs de nós e de documentos restritos por enumeração no formato enviado ao provedor; imagens e anexos não viram fontes documentais |
| JSON inválido no SDK | A validação do SDK podia ocorrer antes do diagnóstico local | Captura restrita de `NoObjectGeneratedError` com etapa/módulo; truncamento identificado separadamente |
| Peça realmente fora do envelope | Rejeição genérica | Rejeição preservada, com indicação dos limites do módulo |

Os caches guardam posições de CPU, sem manter geometrias ou buffers de GPU. Definições customizadas usam `WeakMap`; os quatro modelos curvos básicos compartilham suas posições. A liberdade de `extrude`, `lathe`, `tube` e `buffer` permanece disponível. Os limites de recursos e as verificações de contato continuam ativos; a montagem continua ilustrativa, sem certificar encaixe físico.

## Evidência automatizada

- Casos novos tiveram falhas reproduzidas antes das correções: quatro primitivas curvas, duas geometrias customizadas, dois contratos de referência e os diagnósticos de etapa.
- Checkpoint: 90 testes dirigidos passaram em geração avançada, captura de erros do SDK, limites de peças, decomposição e geometria customizada.
- Não há tentativa paga oculta de reparar respostas: as chamadas continuam com `maxRetries: 0`.
- Falhas não armazenam nem aplicam uma cena parcial.
- Falhas de `sceneSchema` agora carregam `sceneDiagnostics`: contagens e até 12 issues com caminho limitado a oito campos/índices, código e motivo em listas permitidas. Campos desconhecidos viram `?`; valores da cena, IDs, mensagens Zod livres, prompts, imagens e corpos de resposta não são copiados. A inspeção de tipos limita-se aos primeiros 512 objetos e registra separadamente o total e a quantidade inspecionada.
- O acréscimo teve cinco falhas reproduzidas antes da implementação. Checkpoint posterior: 32 testes dirigidos passaram em geração avançada e diagnósticos seguros; incluem escala inválida, topologia, identificadores repetidos, orçamento de malha, descarte de conteúdo privado e interrupção depois de um módulo válido.

## Teste real no ambiente local

O pedido existente de um braço de seis eixos com referência visual MG90S reproduziu uma falha de referências no planejamento. Após a separação explícita dos identificadores, uma segunda execução produziu um plano de sete módulos e validou o primeiro módulo. Uma atualização de arquivos compartilhados recarregou o ambiente de desenvolvimento durante a construção do segundo módulo.

Uma execução posterior usou `generateAdvancedScene` real em um processo Vitest isolado, sem HMR, com IndexedDB em memória e a nuvem desativada. A fixture representativa descreveu um braço de seis eixos com seis MG90S, elos, suportes, contrapeso e garra; uma [fotografia pública do fabricante TowerPro](https://towerpro.com.tw/product/mg90s-3/) foi enviada com análise de pixels habilitada. O backup disponível não continha a referência MG90S da interface, portanto não é uma reprodução idêntica do projeto do usuário. O JPEG de 500×501 pixels foi realmente decodificado com Pillow por um adaptador local, pois JSDOM não implementa `createImageBitmap`; o carregamento de mídia, o SDK e o pipeline de geração permaneceram reais, sem modelo simulado.

| Resultado da execução isolada | Evidência |
| --- | --- |
| Duração | 701,836 s, aproximadamente 11 min 42 s |
| Chamadas ao provedor | Oito respostas HTTP 200, com `maxRetries: 0`; sem nova tentativa paga |
| Seleção e planejamento | Aceitos; plano com sete módulos |
| Módulos 1–5 | Gerados e aceitos, incluindo validação de cena, orçamento, envelope e contatos |
| Módulo 6 | J6 e flange terminal rejeitados por `sceneSchema`: `stage: module`, `code: scene` |
| Módulo 7 e conjunto final | Não executados após a rejeição |
| Aplicação ao projeto | Nenhuma proposta, cena parcial ou alteração nos dados do usuário |

A rejeição do J6 ocorreu antes das verificações de envelope e contato. O diagnóstico dessa execução registra etapa e módulo; o conteúdo rejeitado foi descartado e os detalhes de issues foram acrescentados somente depois. Por isso, não se pode afirmar retrospectivamente qual campo ou regra de geometria falhou, nem atribuir essa falha a limites espaciais. O diagnóstico seguro detalhado foi validado com fixtures; não houve uma segunda execução paga para testá-lo.

Os registros locais ignorados estão em `.codex-audit-senai-2026-10-09/advanced-real-diagnostics.json`; não contêm corpo do provedor ou chave de API. Um preflight anterior identificou a incompatibilidade entre o `AbortSignal` de JSDOM e o `fetch` nativo antes de qualquer envio; ela foi corrigida somente no harness e conferida com uma requisição pública gratuita.

Esse teste não comprova a geração completa do braço, a fidelidade visual, encaixes físicos ou a confiabilidade em pedidos diferentes. A montagem completa continua pendente de uma execução aceita e revisão visual; nenhum resultado artificial foi criado para preencher essa lacuna.
