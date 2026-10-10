# Extração PDF no navegador real

Ensaio de 10/10/2026 no Chrome 155/Windows, com o build da revisão `812b9a9`, servido pelo handler e CSP de produção em uma origem local vazia. Autenticação cloud desligada, chaves vazias e chamadas externas bloqueadas. Nenhuma geração ou cobrança de IA foi realizada.

O [PDF sintético](worker-audit-two-pages.pdf), de 902 bytes, contém duas páginas de texto conhecido. No Estúdio 3D, o `onChange` real do seletor recebeu esses mesmos bytes: o chip apareceu, o pedido conservou o texto extraído e um Worker PDF.js real processou o arquivo sem erros. O anexo foi removido depois do ensaio.

O extrator compilado retornou duas páginas, texto exato e progresso 1/2 → 2/2. Cancelar após a primeira página rejeitou com `AbortError`; o worker terminou tanto após sucesso quanto cancelamento. Uma extração posterior funcionou. Os [resultados originais](2026-10-10-browser-worker.json) preservam os nomes dos assets, ambiente e limitações; o caminho ignorado da fixture registrado nesse JSON corresponde à cópia de teste, cujo conteúdo está versionado aqui.

Isso complementa os testes automatizados que simulam PDF.js. Não comprova o seletor nativo do sistema operacional, pois a extensão usada nesse ensaio não tinha acesso a URLs de arquivos; nenhuma permissão foi alterada. O cancelamento foi acionado pelo `AbortSignal` do extrator, não por um botão da interface. Não foram avaliados PDFs digitalizados, OCR, arquivos protegidos, documentos grandes nem desempenho no tablet.

O recurso atual extrai texto para referências. Um leitor visual de páginas, cards de capa e biblioteca de fontes nos canvases continuam [propostos](../../superpowers/specs/2026-10-10-canvas-source-library-design.md).
