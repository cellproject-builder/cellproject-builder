# Anexos nos canvas

O clipe abre a mesma biblioteca compacta no Dynamic Board e no Construtor de Planos. Importar guarda o original no repositório de mídia existente; o documento guarda apenas identidade, metadados, trecho textual limitado e posição de cartões. Selecionar vários anexos e colocá-los no canvas cria um deck. Arrastar ou usar o botão de adicionar tem o mesmo resultado.

O leitor abre sobre o canvas, com página atual de PDF renderizada sob demanda, imagens e texto. Downloads e leitura são explícitos. Links abrem uma ficha com endereço seguro; páginas que não permitem incorporação continuam acessíveis por abertura externa. Nenhum HTML remoto é executado no canvas. Anexos antigos sem original continuam acessíveis como texto, com essa limitação indicada.

As referências existentes do projeto e imagens do canvas entram na biblioteca. Usar no chat seleciona a fonte e abre o compositor, sem enviar automaticamente. A biblioteca segue a cifra e o transporte de mídia existentes, os limites de tamanho e a validação de revisões; importações são canceladas quando o usuário troca de canvas ou sessão. Coletores de mídia e exportação precisam reconhecer a nova coleção.

## Limites desta entrega

O catálogo aceita PDF, PNG/JPEG/WebP, TXT/Markdown e URLs HTTP(S). PDFs antigos anexados pelo chat podem conter somente texto; o original precisa ser reanexado. PDF escaneado preserva as páginas, mas não ganha OCR. A pesquisa do chat continua usando suas ferramentas existentes: salvar automaticamente um resultado confirmado nessa biblioteca ainda requer uma ação compartilhada específica.

Links abrem uma ficha com endereço e ação de abrir a página original. Não há navegador remoto incorporado nem extração automática de HTML. O leitor de PDF mantém um documento por instância, renderiza uma página por vez e limita cada raster a 4096 pixels por dimensão e cerca de 4 megapixels. Trocar conta ou arquivo cancela a renderização e destrói o worker.

Os cartões de anexos usam uma camada de coordenadas do React Flow, com drag, resize, teclado e remoção da instância. Ainda não participam da seleção múltipla, clipboard, histórico de tinta ou enquadramento automático dos nós; o arquivo permanece na biblioteca ao remover apenas seu cartão. As referências de projetos existentes aparecem na biblioteca do plano, mas imagens inline antigas do Board não são migradas automaticamente para Storage.
