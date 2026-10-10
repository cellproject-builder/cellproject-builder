# Ícones e cores dos projetos

Cada projeto pode guardar `appearance: { icon, color }`. O ícone é um ID estável compatível com os nomes de exportação da biblioteca Radix; a cor é um hexadecimal `#RRGGBB`. O catálogo conserva os 318 IDs da biblioteca e a opção `planner`. A identidade persistida de um ícone é independente da família SVG usada para apresentá-lo.

O módulo está agrupado em [workspace/project-appearance](../src/workspace/project-appearance/): schema, catálogo, seletor, CSS e testes unitários. [Projects.appearance.test.tsx](../src/workspace/Projects.appearance.test.tsx) permanece junto da tela por verificar a integração. Contratos gerais estão em [projetos e planner](modules/planner-projects.md).

O seletor está na criação/edição do projeto, também acessível pelo lápis no cartão. Busca por nome e sinônimos em português, paleta e cor personalizada alteram somente o rascunho. Salvar aplica; cancelar descarta. Teclas direcionais percorrem os resultados e Enter ou Espaço escolhe o ícone.

A personalização aparece no cartão, na identificação da barra lateral, no caminho de navegação, no título da visão geral e nos subgrupos virtuais da [biblioteca de notas](modules/notes.md#organização-da-biblioteca). Os ícones de ferramentas continuam representando suas ações.

## Família visual compartilhada

[SoftIcons.tsx](../src/components/ui/SoftIcons.tsx) adapta a biblioteca oficial [Lucide React](https://lucide.dev/guide/packages/lucide-react), fixada na versão `1.55.0`. A base usa SVGs com traço `1.7`, pontas e junções arredondadas, herdando a cor do componente. Chamadores podem ajustar tamanho e espessura; atributos SVG, refs e nomes acessíveis são preservados. Ícones decorativos ficam ocultos da árvore de acessibilidade por padrão, sem ocultar ícones explicitamente rotulados.

Navegação, notas, Board, tarefas e outras ações que importavam ícones Radix passam pela base compartilhada. O catálogo de projetos aplica substituições Lucide aos ícones comuns de engenharia, estudo, organização e comunicação, incluindo o ícone padrão de plano. As opções legadas restantes continuam disponíveis; não há importação do catálogo Lucide inteiro nem uso de fonte ou emoji como substituição.

Por exemplo, um projeto salvo com `icon: 'GearIcon'` continua guardando `GearIcon` e a mesma cor, mas seu SVG passa a usar a engrenagem da família Lucide. Essa troca ocorre no renderer e não reescreve os registros. Ícones válidos desconhecidos por este cliente conservam o ID salvo e usam a representação padrão.

Projetos antigos não precisam de migração. IDs válidos desconhecidos são preservados para portabilidade e exibidos com o desenho padrão neste cliente. As escolhas acompanham o envelope existente de persistência, backup e cofre; o exportador tabular também inclui `appearance`. Nenhuma mudança no banco remoto foi necessária.

Os nomes pesquisáveis dos 318 ícones ficam em um módulo estático gerado. Os SVGs comuns carregam com a família compartilhada; o catálogo Radix estendido usa import dinâmico quando um ícone dele é exibido. Se o chunk falhar, uma fronteira local mostra o ícone padrão e preserva o ID/cor salvos. A próxima carga da página pode tentar novamente. O gerador e os testes conferem o catálogo contra a dependência instalada. Ver [medição de carregamento](design/plan-quality/performance/README.md).

## Evidências e limites

Registro da entrega anterior em 10/10/2026: 1.216 testes aprovados, 8 ignorados e build aprovado. No navegador: escolha por busca e teclado, cor salva após recarregar e seletor sem rolagem horizontal a 390 px CSS. Ao fechar a biblioteca, o foco retorna ao botão de escolha.

Na atualização de família visual e biblioteca, em 10/10/2026, `npm test -- src/components/ui/SoftIcons.test.tsx src/workspace/project-appearance/ProjectIconPicker.test.tsx src/workspace/NotesLibrary.test.tsx` aprovou 18 testes. Foram examinados atributos SVG e acessibilidade, manutenção de IDs/cores, seleção por teclado, agrupamento virtual e criação contextual nas notas. Esse resultado focado não substitui uma execução da suíte completa, build ou revisão visual do estado integrado.
