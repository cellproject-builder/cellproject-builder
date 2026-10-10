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

## Teste real no ambiente local

O pedido existente de um braço de seis eixos com referência visual MG90S reproduziu uma falha de referências no planejamento. Após a separação explícita dos identificadores, uma segunda execução produziu um plano de sete módulos e validou o primeiro módulo. Uma atualização de arquivos compartilhados recarregou o ambiente de desenvolvimento durante a construção do segundo módulo.

Esse checkpoint não comprova a geração completa do braço nem sua fidelidade visual. A execução completa deve ser conferida numa build estável, sem atualização automática no meio das chamadas. Nenhuma proposta parcial foi aplicada.
