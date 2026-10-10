# Dynamic Diary

Um espaço para aprender, compreender e construir: planos examináveis, notas, quadros livres e artefatos visuais com apoio de IA.

A contribuição científica pretendida é um método de desconstrução de planos orientado por evidências físicas: **premissa → previsão/critério próprio → ensaio → observação → revisão justificada**. O robô de dois braços é o estudo de caso; sua conclusão, a eficácia do método e resultados de aprendizagem não são pressupostos. O [objetivo aprovado do artigo SENAI](docs/OBJETIVO_DO_ARTIGO.md) governa esse recorte.

## Começar pelo lugar certo

| Necessidade | Referência |
| --- | --- |
| Entender as funcionalidades e suas integrações | [Catálogo dos módulos](docs/modules/README.md) |
| Navegar por toda a documentação | [Índice de documentação](docs/README.md) |
| Encontrar código e decidir onde colocar arquivos | [Mapa do repositório](docs/repository-map.md) |
| Entender propriedade de dados e fronteiras | [Arquitetura](docs/architecture.md) |
| Usar a implementação em artigos, com limites de evidência | [Guia de pesquisa](docs/research/README.md) |
| Conferir o que foi organizado e verificado nesta revisão | [Relatório de organização](docs/reports/repository-review-2026-10-10.md) |

## O que existe

- **Projetos e planos:** árvore tipada, decomposição, critérios próprios, observações, referências e revisão a partir de falhas. Kanban e Scrum organizam execução, sem certificar a validade física do plano.
- **Canvas do plano:** imagens, referências e artefatos independentes, com vínculos opcionais. Estúdio 3D com geração modular, edição contextual, rotação/zoom e decomposição documentada. Fontes e medidas podem orientar dimensões; geometria, contatos e encaixes gerados permanecem ilustrativos e exigem validação física.
- **Diagramas:** React renderiza documentos SVG declarativos, com parâmetros e interação. Execução de React arbitrário gerado é uma experiência de laboratório, não o contrato de produção.
- **Notas e Dynamic Board:** caderno visual nas notas; quadro livre com textos, desenhos, imagens e artefatos. Cada superfície possui seu documento e contexto; copiar conteúdo não cria sincronização entre eles.
- **Chat com ações:** referências com `@`, anexos, pesquisa de componentes e ferramentas validadas do workspace/planner. **Dairo é uma proposta documentada**, ainda sem agente de memórias/resumos diários entregue.
- **Dados e plataforma:** armazenamento local ou cloud configurada, backup portátil e cofre opcional com criptografia no cliente. Backend Node para Railway; Supabase para Auth e persistência. A configuração atual tem limites de uma conta autorizada e uma instância de servidor.

O [catálogo](docs/modules/README.md) descreve por módulo os fluxos, contratos, arquivos, testes, limites e perguntas investigáveis. Funcionalidade implementada não equivale a validação em usuários, dispositivo físico ou produção remota.

## Executar localmente

No checkout deste repositório, com Node/npm compatíveis com o projeto:

```sh
npm install
npm run dev -- --host 127.0.0.1 --port 5190 --strictPort
```

Abra [http://127.0.0.1:5190/](http://127.0.0.1:5190/). Se a porta já estiver ocupada pela sessão de desenvolvimento, reutilize-a. Gestão local e edição manual não exigem chamada de IA; geração e pesquisa precisam das respectivas configurações.

[.env.example](.env.example) documenta as variáveis. Arquivos `.env` ficam fora do Git. Reinicie o servidor após mudar variáveis. O fluxo local pode usar chaves do navegador/ambiente de desenvolvimento; o cloud usa credenciais no servidor. Consulte [orquestração de IA](docs/modules/ai-orchestration.md) e [plataforma](docs/modules/platform-and-delivery.md) antes de configurar outro ambiente. Nunca publique chaves em documentação ou fixtures.

## Verificar

```sh
npm run check:repo
npm test
npm run test:gateway
npm run build
npm run check:bundle
```

`check:repo` verifica destinos locais da documentação mantida, configuração Vite e sete fronteiras transitivas de contratos. `lint` atualmente executa TypeScript; não há linter estilístico separado. Testes usam simulações onde indicado; por padrão, sem opt-in das suítes live, não fazem novas chamadas pagas. `LIVE_OPENROUTER_KEY` ou `LIVE_ENV_FILE` habilitam os ensaios live incluídos na suíte. Experimentos manuais e verificações SQL possuem protocolos próprios em [scripts](scripts/README.md).

## Publicação, dados e privacidade

`npm run build` produz `dist`; `npm start` serve a aplicação e suas APIs pelo Node. `npm run preview` e hospedagem apenas estática não fornecem os gateways de pesquisa, IA ou cloud. Consulte [produção](docs/cloud-production.md), [PWA](docs/pwa.md) e [dados e privacidade](docs/modules/data-and-privacy.md).

Com o cofre ativado, o armazenamento recebe conteúdo cifrado; o cliente desbloqueado e os provedores usados com contexto autorizado podem processar conteúdo legível. Isso não impede acesso por código malicioso executado no cliente aberto. O shell PWA cacheado também não garante inicialização offline. Os limites completos estão documentados nos respectivos módulos.

Nomes persistidos `cellproject-*` permanecem por compatibilidade com dados existentes; o nome do produto é **Dynamic Diary**. Experimentos em `docs/design/` e conceitos em [arquivo histórico](docs/archive/README.md) preservam sua proveniência.
