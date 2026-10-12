# Configurar o MCP no runtime

A configuração pronta desta máquina, com a credencial preenchida, está em `C:/__dev_ops__/@artigo/cellproject-builder/.mcp-runtime.private.md`. Esse arquivo tem acesso restrito ao usuário Windows e está excluído do Git. Copie o bloco JSON dele para o runtime.

O modelo abaixo fica versionado para novas instalações. Ele usa o caminho do Node.js e do projeto nesta máquina Windows, com a URL canônica da aplicação.

```json
{
  "mcpServers": {
    "cellproject": {
      "command": "C:/Program Files/nodejs/node.exe",
      "args": [
        "C:/__dev_ops__/@artigo/cellproject-builder/server/mcp.mjs"
      ],
      "env": {
        "CELLPROJECT_API_URL": "https://builder.cellprojectdiary.com",
        "CELLPROJECT_API_TOKEN": "COLE_AQUI_A_CREDENCIAL_GERADA_EM_API_E_MCP"
      }
    }
  }
}
```

Substitua `COLE_AQUI_A_CREDENCIAL_GERADA_EM_API_E_MCP` pelo token completo criado em **Configurações → API e MCP**, depois de entrar na conta e desbloquear o cofre. A credencial começa com `cp_`. Cole somente o token, sem o prefixo `Bearer`. O Markdown mantém um marcador; guarde a credencial real na configuração privada do runtime.

Se o runtime já tiver `mcpServers`, adicione apenas a entrada `cellproject` dentro desse objeto. Em outra máquina, instale as dependências do projeto e ajuste `command` e `args` para os caminhos locais do Node.js e de `server/mcp.mjs`. Use Node.js 22 ou superior.

O runtime precisa aceitar MCP por **stdio**: ele inicia o processo local, que acessa a API pela rede. `CELLPROJECT_API_URL` recebe a origem da aplicação, sem `/api/v1` ou `/mcp`. Um runtime que aceita somente uma URL de MCP remoto precisa de outro transporte.

A API em `https://builder.cellprojectdiary.com` foi habilitada em 12/10/2026: migração aplicada e variáveis do servidor configuradas no Railway. Em outro ambiente, seguir o [guia de ativação](EXTERNAL_API.md#ativação-no-servidor) e criar uma credencial própria. O modelo versionado mantém um marcador para o token.

Depois de salvar, recarregue os servidores MCP no runtime e peça para listar os projetos disponíveis. O acesso seguirá os projetos e permissões concedidos à credencial, usando a inteligência do runtime externo.
