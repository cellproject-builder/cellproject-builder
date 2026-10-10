# Gestos do Board no navegador

Ensaio de 10/10/2026 no Chrome 155, com o build de produção servido numa origem local isolada, sem cloud, chaves ou chamadas externas. O viewport CSS de **390×220** representa um canvas estreito e baixo. O bundle carregado antecede o rebuild final do NoteInkOverlay, mas já contém o código final de BoardCanvas e InkPalette.

Os [resultados originais](2026-10-10-board-browser.json) registram eventos nativos sintéticos via CDP, transformações DOM, prévias SVG e quantidade de objetos; nenhum store da aplicação foi lido. Dedo fez pan e pinça sem criar traços. Com a opção de desenhar com dedo, um traço foi salvo e desfeito; adicionar o segundo dedo cancelou a prévia e continuou a navegação sem salvar rabisco.

A paleta [recolhida](board-collapsed-390x220.jpg) ocupou 44×44 px. Clique manteve o painel aberto, hover abriu/recolheu, e a [paleta expandida](board-expanded-390x220.jpg) permitiu rolar os controles internamente até a opção de dedo, sem mover o canvas. Não foram observados erros de console durante os gestos.

O quadro de teste ficou sem traços ao terminar; aba, instrumentação, viewport temporário e servidor de preview foram encerrados. Os servidores do projeto não foram interrompidos nesse ensaio. Pressão, rejeição de palma, latência e sensação com S Pen física não foram medidas. A revisão independente do overlay conferiu coordenadas e âncoras em Chrome real, mas este registro específico cobre o Board.
