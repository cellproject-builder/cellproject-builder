# Probe de nomenclatura em diagramas

Ensaio local isolado. Usa o prompt **real do plano** exportado por `buildDiagramSystem('plan')`, incluindo `diagramColorGuide`, `diagramLabelGuide` e o schema de geração atual. A validação local usa `parseGeneratedDiagram(raw, [])`. Não importa cliente autenticado, stores de projetos ou dados do usuário.

O pedido é um **esquema funcional ilustrativo**, sem pinagem de montagem: ESP32, PCA9685, fonte e capacitor sem ratings e 14 servos em dois grupos de sete (J1–J6 e garra). Nomes de canais e cores são exemplos, sem certificar compatibilidade elétrica. O contexto é inteiramente sintético.

## Antes da inferência

O script não chama o provedor sem `--run`. **A chamada paga só deve ser executada depois da confirmação do prompt final pelo responsável pela integração.**

```powershell
npx vite-node --config scripts/diagram-labels/vite.config.ts --mode test scripts/diagram-labels/run.ts --print-prompt
npx vitest run --config scripts/diagram-labels/vitest.config.ts
```

`--print-prompt` imprime somente o system/pedido sintéticos e hashes; não carrega credenciais. O script de inferência usa `loadEnv('development', PRIMARY, '')`, com `PRIMARY = C:\__dev_ops__\@artigo\cellproject-builder`, e mantém a chave exclusivamente em memória. Não imprime ambiente, chave, headers ou erros brutos do provedor.

## Uma única primeira resposta

Após aprovação explícita do prompt:

```powershell
npx vite-node --config scripts/diagram-labels/vite.config.ts --mode test scripts/diagram-labels/run.ts --run
```

Configuração fixa: OpenRouter, modelo `openai/gpt-6.1-sol`, raciocínio `medium`, `maxOutputTokens: 16000`, `maxRetries: 0`, timeout de 180 segundos. Uma única chamada `generateText`; sem reparo, seleção da melhor resposta ou nova tentativa após falha. O limite de tokens é uma configuração do ensaio, não uma alteração dos budgets da aplicação.

A pasta `docs/reports/data/diagram-labels-2026-10-11/` é reservada atomicamente antes da chamada. Se já existir, o script recusa execução para preservar a primeira tentativa. Não há opção de sobrescrita. Uma interrupção também conserva o manifesto iniciado; sua presença bloqueia uma nova chamada acidental.

Arquivos:

- `response.txt`: texto exato da primeira resposta, antes de parse/validação.
- `diagram.json`: JSON decodificado sem alterações, mesmo se o quality gate rejeitar; `null` quando não há JSON decodificável.
- `manifest.json`: pedido e system completos, hashes, revisão Git, modelo/configuração, duração, usage, finishReason, identificação da resposta, resultado do parser e cobertura desta amostra. Erro de transporte fica registrado sem payload de erro do provedor.

A cobertura procura nomes nos elementos `text`, incluindo os 14 identificadores distintos A-J1…A-J6/A-Garra e B-J1…B-J6/B-Garra, ESP32, PCA9685, fonte, capacitor e legenda. É um diagnóstico textual específico desta amostra; não mede visibilidade real, layout, redes elétricas ou verdade física. Título, explicação e IDs internos não substituem rótulos do SVG.

### Primeira execução preservada — 11/10/2026

Uma chamada foi executada após confirmação do prompt final. A resposta terminou com `finishReason: stop`, passou por `parseGeneratedDiagram` e apresentou cobertura textual completa: 14 servos distintos e todos os cinco itens ESP32/PCA9685/Fonte/Capacitor/Legenda. Foram 76 elementos, 47 deles `text`, em viewBox 560 × 500. Não houve reparo nem segunda chamada.

Duração: 67.396 ms. Usage: 2.496 tokens de entrada e 4.455 de saída (3.440 de texto e 1.015 de raciocínio), 6.951 no total. O manifesto preserva usage original e hashes das fontes/pedidos. System SHA-256: `b352df097bbb2be3264ab87801f4454df0d08702bcff331742583d2f8f38c36c`; texto da resposta SHA-256: `aa8f465c3f9dde2635946eea93b22111cb87f25bac6d7afcd22f9614362ea1de`.

Esses números registram aceitação e cobertura da primeira saída. A inspeção do SVG visível e suas capturas em desktop/mobile são verificações separadas; não são inferidas do parser.

## Viewer e evidência visual

```powershell
npx vite --config scripts/diagram-labels/vite.config.ts --host 127.0.0.1 --port 5201 --strictPort
```

Abrir `http://127.0.0.1:5201/scripts/diagram-labels/`. A página renderiza `DiagramView` real sobre superfície escura, com SVG transparente e estágio de referência 560 × 500, responsivo à largura disponível. Mostra separadamente uma **fixture manual de capacidade do renderer**, sem inferência, e a **primeira resposta de IA**, quando os arquivos existem. Resultado rejeitado permanece identificado; o viewer não o corrige. O build do viewer também pode ser produzido com `npx vite build --config scripts/diagram-labels/vite.config.ts`.

Inspeção a registrar em desktop (1280 × 720) e viewport móvel (390 × 844): conferir nomes e legenda no SVG visível, os 14 servos distintos, cortes/sobreposição, contraste e tamanho efetivo após redução. Capturas e verificações DOM são evidências separadas da aceitação do parser. Não há chamada de IA ao abrir a página, nem acesso à conta do usuário; o bundle usa envDir sem arquivos de ambiente e não injeta chave.

Este ensaio não demonstra qualidade geral da geração, fluidez em tablet, segurança elétrica, montagem ou funcionamento físico. Uma saída válida e nomeada continua sendo uma representação ilustrativa.
