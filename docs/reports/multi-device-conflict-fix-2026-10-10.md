# Conciliação de alterações entre aparelhos

Revisão em 10/10/2026. Escopo: conflito ao usar PC e tablet ao mesmo tempo, aviso impossível de fechar e uma corrida na renovação de sessão. Esta entrega não redefine senhas, não troca chaves e não apaga documentos ou rascunhos.

## Problema e comportamento resultante

Projetos, notas, quadros e desenhos compartilham o envelope `cellproject-workspace`. O cofre também publica todas as chaves em um único manifesto cifrado, protegido por revisão. Assim, editar uma nota no PC e desenhar em outro quadro no tablet podia produzir HTTP 409 mesmo sem sobreposição de conteúdo. A fila mantinha o rascunho, mas não tentava uma conciliação segura. O painel de aviso era forçado a permanecer aberto enquanto houvesse erro.

Agora, uma rejeição explícita por revisão permite ler a versão remota autenticada e comparar três estados: base comum, edição local atual e conteúdo remoto. Alterações independentes são reunidas; uma gravação subsequente de um editor ainda desatualizado também preserva os dados recebidos do outro aparelho. O estado canônico é aplicado ao editor quando os guards permitem a atualização.

- Documentos diferentes podem avançar mesmo quando disputam a revisão global do cofre.
- Campos independentes, registros diferentes e novos traços com IDs distintos podem ser conciliados dentro do mesmo envelope.
- Texto divergente no mesmo campo, remoção contra edição, ordens incompatíveis e topologia de grafo concorrente permanecem em conflito, com o rascunho preservado. Não há escolha pelo relógio do aparelho nem CRDT de texto.
- O checkpoint global do planner só pode ser tratado como redundante quando os snapshots gerenciados por projeto comprovam a preservação integral dos dois grafos.
- O aviso pode ser fechado e reaberto pelo indicador. Escape funciona com foco no painel e retorna o foco ao indicador. Fechar o painel não descarta o problema nem o trabalho pendente.

## Criptografia, durabilidade e identidade

[VaultTransport](../../src/cloud/vault/transport.ts) só troca a revisão base após `vault_revision_conflict` explícito. Rejeição por identidade de operação continua distinta. Uma resposta perdida repete a mesma identidade e os mesmos bytes; não é tratada como rejeição. O manifesto conciliado recebe uma identidade de envio nova e é persistido antes da tentativa remota. O runtime preserva a identidade lógica da edição e só retira operações definitivamente rejeitadas após confirmar o checkpoint substituto.

A fila, os recibos e os checkpoints continuam cifrados. Conta, cabeçalho, revisões e integridade são conferidos antes da adoção remota. As RPCs, RLS e o contrato de autorização não foram relaxados; não há migration de banco nesta correção. Uma mídia idêntica registrada pelos dois aparelhos deixa de prender um upload preparado sem uso.

O cliente novo aceita checkpoints antigos. Um checkpoint pendente criado pelo novo transporte pode conter uma identidade lógica diferente da identidade de envio: **não fazer downgrade para um cliente antigo enquanto houver fila pendente**. Esta entrega não afirma compatibilidade de rollback desse journal.

## Sessão e pedido de senha

[cloudAuth.mjs](../../server/cloudAuth.mjs) agora distingue a recusa tardia de um token antigo da recusa do token atual. Se outra chamada já renovou a sessão, a resposta atrasada não revoga automaticamente a credencial nova: o servidor verifica o token atual. Uma recusa real continua encerrando a autorização.

Essa corrida foi reproduzida em teste. A causa exata do pedido inesperado de recuperação de senha relatado pelo usuário não foi comprovada; não deve ser apresentada como resolvida apenas por essa mudança. Conflito de revisão não inicia redefinição de senha.

## Evidência desta entrega

| Verificação | Resultado |
| --- | --- |
| Suíte completa do cliente | 189 arquivos aprovados, 2 ignorados; 1.830 testes aprovados, 8 ignorados |
| Suíte completa do servidor | 226 aprovados, 1 ignorado; nenhuma falha |
| TypeScript e build de produção | Aprovados; permanecem avisos de chunks grandes e base Browserslist antiga |
| Auditoria de repositório e bundle | Aprovadas; sem alvo local quebrado ou módulo de funcionalidade antecipado no bundle |
| Ensaio no navegador com WebCrypto real | Dois clientes cifrados, CAS simulado, uma rejeição e conciliação; nota do PC e segunda edição do quadro do tablet preservadas, filas vazias |
| Painel no navegador | Fechar, reabrir pelo indicador e Escape com foco interno conferidos |

[documentMerge.test.ts](../../src/cloud/documentMerge.test.ts) cobre 53 cenários de conciliação e recusa. [runtime.test.ts](../../src/cloud/runtime.test.ts) cobre 33 casos de fila, revisão e preservação. [concurrency.test.ts](../../src/cloud/vault/concurrency.test.ts) cobre dez cenários com dois clientes e criptografia real, incluindo respostas perdidas, restauração, traços simultâneos, conflito incompatível, quota e mídia idêntica. [CloudLiveSync.integration.test.ts](../../src/cloud/CloudLiveSync.integration.test.ts) verifica os stores Zustand reais.

O [ensaio visual](../design/multi-device-validation/index.html) usa somente conteúdo sintético e servidor em memória. Não comprova Auth Supabase, latência de produção ou desempenho de caneta física. A validação anterior do S9 confirmou transmissão durante o desenho com atraso; **esta correção ainda precisa de novo ensaio físico PC + S9**. Os avisos React `act` e de compatibilidade de SDK emitidos pelas suítes não produziram falhas.

## Como conferir sem descartar trabalho

Depois de confirmar que as alterações estão salvas neste aparelho ou na nuvem, atualizar o aplicativo nos dois aparelhos. Abrir uma nota no PC e outro quadro no tablet, editar ambos e conferir que as duas alterações aparecem após a sincronização. Repetir com novos traços distintos no mesmo quadro. Um conflito incompatível deve preservar o rascunho e permitir fechar o aviso; `Conciliar alterações` tenta novamente sem limpar o cofre. Não apagar dados do site como procedimento de recuperação.
