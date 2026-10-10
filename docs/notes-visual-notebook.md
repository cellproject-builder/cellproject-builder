# Caderno visual nas notas

Objetivo: escrever, desenhar e explorar ideias na mesma nota, com ferramentas curtas e opcionais. A biblioteca, os vínculos com projetos e os parágrafos existentes continuam no editor. A área visual integra traços vetoriais, textos livres, imagens e diagramas React/SVG interativos.

## Interação

- O lápis do editor ativa a tinta livre sobre a nota inteira, sem esconder os parágrafos. O caderno separado continua opcional para organizar imagens, textos livres e diagramas. Sua barra fica junto ao topo do editor, fora da área de escrita.
- Caneta, bico de pena, monoline, lápis e marca-texto compartilham uma paleta compacta nos três espaços: notas, Dynamic Board e Construtor de Planos. Espessura, opacidade e uma prévia abrem no ajuste do traço; o caderno mantém régua e tipo de folha nas opções.
- Mouse, toque e caneta usam coordenadas da folha. Um gesto é uma operação de desfazer. A régua ajuda a criar segmentos retos; não representa escala física.
- Colar uma imagem com Ctrl+V ou escolher um arquivo coloca a imagem na folha. Seleção permite mover e redimensionar; cantos seguem o arredondamento do editor.
- Expandir mantém o mesmo editor montado e recolhe os controles de formatação durante o desenho. Sair do desenho devolve os eventos ao texto; os parágrafos continuam visíveis e montados durante todo o processo.
- Ampliar/reduzir a folha de 1× a 3× permite inspecionar detalhes, com rolagem interna. As posições e os tamanhos persistidos não mudam com o zoom.
- Gerar um diagrama abre um compositor curto na nota, com a opção de usar o conteúdo dela. A prévia precisa ser inserida explicitamente. Mover o desenho não muda o contexto semântico; editar o conteúdo durante a geração pede revisão.

## Dados e privacidade

`Note.canvas` é opcional para preservar notas antigas. Traços, itens e diagramas são documentos validados. Imagens PNG/JPEG/WebP são decodificadas, reduzidas e incorporadas na nota com limites de tamanho; não dependem de URLs remotas ou de um projeto aberto. O envelope existente do workspace armazena esse conteúdo, inclusive no cofre quando ativo.

A geração usa apenas a nota solicitada quando a opção de contexto está marcada. Imagens não enviam pixels implicitamente à IA. O motor recebe dados declarativos SVG e valida o resultado; não executa JavaScript ou HTML produzidos pelo modelo. Leituras da IA recebem resumos do caderno sem os bytes das imagens.

## Validação

Em 10/10/2026: suíte completa com 1.195 testes aprovados e 8 ignorados; build de produção aprovado. A revisão final corrigiu a colagem de diagramas para preservar os valores atuais dos controles, com 13 testes focados aprovados depois da correção.

No navegador local foram conferidos colagem nativa de PNG, desenho, régua, desfazer/refazer dos traços, texto livre, movimento/redimensionamento, controles do diagrama, persistência e editor maximizado. A 390 px, a página não apresentou rolagem horizontal; o zoom de 2× ficou contido na folha. Toque e caneta foram cobertos por eventos simulados, sem validação em hardware físico.

A geração foi testada com respostas controladas e uma chamada real ao provedor, usando somente um pedido sintético de alavanca ideal, sem conteúdo da nota. A resposta real passou pela validação e apareceu como prévia React/SVG com controle de massa e cálculo de torque. A nota de demonstração `QA · Caderno visual` usa uma referência local e um diagrama sintético; não representa validação física.
