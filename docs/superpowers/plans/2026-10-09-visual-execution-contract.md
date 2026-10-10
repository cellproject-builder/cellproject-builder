# Contrato da entrega dos pop-ups visuais

Execução autorizada pelo pedido “vamos adicionar 2 pop ups no canva”. Aplicar a especificação visual e o objetivo do artigo, com interfaces pequenas e revisão independente. Preservar o checkout atual em `feat/project-workspace`: contém trabalho anterior necessário à integração. Sem commit, push ou deploy.

Divisão: domínio/mídia/geração; galeria/compositor/pop-ups; gateway/busca; integração/renderização/chat. Os arquivos têm donos distintos. A entrega deve funcionar com imagens locais e contexto por @ mesmo sem provedor configurado; busca e geração reais mostram erros de configuração, nunca resultados fabricados. Não é necessário implementar nesta entrega o pacote ZIP/inspector avançado/animador previstos no roteiro maior. Exportação JSON existente precisa preservar os visuais e sua mídia, com limites explícitos.

## Tipos compartilhados (src/visuals/types.ts, domínio é dono)

- `MentionTarget`: `{id:string; kind:'note'|'node'|'image'; label:string; detail:string; fingerprint:string}`.
- `VisualAttachment`: `{id:string; name:string; mime:string; byteLength:number; mediaId:string|null; text:string|null}`.
- `VisualPromptInput`: `{text:string; mentions:MentionTarget[]; attachments:VisualAttachment[]}`.
- `ImageReference`: `{id:string; title:string; description:string; imageUrl:string; sourcePageUrl:string; credit:string|null; license:string|null; width:number|null; height:number|null; assessment?:VisualAssessment|null; sessionId?:string}`. `VisualAssessment` preserva avaliações antigas com score/confidence e o DTO textual completo validado (modelo, rubrica, probabilidades, legenda e instante).
- `SceneV1`: `{version:1; label:string; objects:Array<{id:string;type:'box'|'sphere'|'cylinder'|'cone'|'torus';position:[number,number,number];rotation:[number,number,number];scale:[number,number,number];color:string}>}`. Limite 128, números finitos abs<=10000, escalas positivas. Somente cena declarativa; sem código/URL/HTML.
- `VisualArtifact`: `{id:string;label:string;kind:'image'|'model';x:number;y:number;width:number;height:number;mediaId:string|null;scene:SceneV1|null;source:ImageReference|null;revisions:Array<{scene:SceneV1|null;mediaId:string|null;createdAt:number}>;revisionIndex:number}`.
- `VisualProposal`: `{id:string;projectId:string;label:string;scene:SceneV1;input:VisualPromptInput;contextFingerprint:string;createdAt:number;status:'ready'|'applied'|'stale'}`.
- `VisualWorkspace`: `{version:1;mode:'approval'|'automatic';artifacts:VisualArtifact[];proposals:VisualProposal[];drafts:{search:VisualPromptInput;model:VisualPromptInput}}`.

## API domínio (src/visuals/domain.ts / media.ts / generation.ts)

- `getVisualWorkspace(project:Project|null):VisualWorkspace` valor vazio estável.
- `listMentionTargets(query:string):MentionTarget[]` só IDs/rótulos das notas pessoais/do projeto, nós e imagens do plano atual.
- `saveVisualDraft(kind:'search'|'model',input:VisualPromptInput):void`.
- `setVisualMode(mode:'approval'|'automatic'):void` só humano chama.
- `updateVisualArtifact(id:string,patch:Partial<Pick<VisualArtifact,'x'|'y'|'width'|'height'>>):void`.
- `removeVisualArtifact(id:string):void`, `revertVisualArtifact(id:string):void`.
- `applyVisualProposal(id:string):VisualArtifact` verifica escopo/contexto/mídia; idempotente.
- `attachVisualFile(file:File,signal?:AbortSignal):Promise<VisualAttachment>` PDF/TXT/MD/PNG/JPEG/WebP, original persistido sem envio.
- `readVisualMedia(mediaId:string):Promise<Blob|null>`; URL de objeto criada/revogada pelo consumidor.
- `addLocalImage(file:File,point:{x:number;y:number},signal?:AbortSignal):Promise<VisualArtifact>`.
- `addReferenceImage(reference:ImageReference,point:{x:number;y:number},signal?:AbortSignal):Promise<VisualArtifact>` busca bytes via gateway antes de publicar.
- `resolveVisualContext(input:VisualPromptInput):{text:string;fingerprint:string}` só fontes escolhidas, texto limitado/critério oculto respeitado; fingerprint detecta edição/exclusão/revisão.
- `generateVisualModel(input:VisualPromptInput,options:{signal:AbortSignal;beforeRequest?:()=>Promise<void>}):Promise<VisualProposal>` config BYOK, generateObject + validação local; approval guarda proposta, automatic aplica só se escopo ainda atual. Imagens são referência textual (sem análise de pixels nesta entrega).

## API busca (src/visuals/search.ts)

`searchVisualImages(input:VisualPromptInput,options:{signal:AbortSignal;beforeRequest?:()=>Promise<void>}):Promise<ImageReference[]>` usa pesquisa real e gateway `/api/visuals/reference-sessions` para extrair URLs reais de imagens; fallback Commons permitido. TypeSafe avalia só metadados, chave servidor. `/api/visuals/media?sessionId=…&candidateId=…` retorna bytes validados do candidato registrado; `imageUrl` devolvido pelo adapter aponta essa URL mesma origem (jamais expõe chave).

## API apresentação (src/visuals/ui/VisualExplorer.tsx)

`VisualExplorer` recebe props:
```
{ workspace:VisualWorkspace; projectId:string;
  listMentions:(query:string)=>MentionTarget[];
  onDraft:(kind:'search'|'model',input:VisualPromptInput)=>void;
  onAttach:(file:File,signal?:AbortSignal)=>Promise<VisualAttachment>;
  onSearch:(input:VisualPromptInput,signal:AbortSignal)=>Promise<ImageReference[]>;
  onGenerate:(input:VisualPromptInput,signal:AbortSignal)=>Promise<VisualProposal>;
  onAdd:(reference:ImageReference,clientPoint?:{x:number;y:number})=>Promise<void>;
  onApply:(proposalId:string)=>void;
  onMode:(mode:'approval'|'automatic')=>void;
  onMedia:(id:string)=>Promise<Blob|null>;
}
```
`uiStore.ts` expõe `useVisualPopupStore` Zustand: `{searchOpen:boolean;modelOpen:boolean;modelBase:MentionTarget|null;open:(kind:'search'|'model')=>void;close:(kind)=>void;useAsBase:(target:MentionTarget)=>void}`. Root pode ampliar para chat; evitar dependência de contexto de ReactFlow. Pop-ups não modais arrastáveis pelo cabeçalho, independentes, rascunhos persistidos, @ picker/IME/Esc/Enter, anexos sem enviar, grade 3×3 e deck com wheel/swipe/teclado, cartões com adicionar/copiar/base3D. `onAdd` com clientPoint no drop; root faz screenToFlowPosition. Arraste nativo payload `application/x-cellproject-reference` com JSON `{projectId,reference}`; root recebe no contêiner externo, bloqueia drop no próprio popup e valida projeto. Popup só inicia busca/geração após enviar. UI pode usar core types enquanto dono de domínio os escreve.

## Registro

- Domínio/mídia/geração: implementados. Contexto selecionado por `@`, proteção do critério oculto, escopo por plano/proprietário, invalidação de respostas tardias, cenas declarativas validadas e propostas em aprovação/automático. Integração LLM real implementada; nenhuma inferência paga executada na validação.
- Mídia e portabilidade: implementadas. Originais em IndexedDB, imagens de até 5 MiB/16 MP, documentos de até 10 MiB, PDF até 100 páginas, quota por plano e coleta segura de órfãos. JSON portátil preserva revisões, fontes e anexos; importação assíncrona verifica contexto e valida antes de gravar mídia. Avaliações textuais completas sobrevivem a exportação, importação e recarga.
- Gateway/busca: implementados e cobertos por 14 testes. Execução restrita ao Vite de desenvolvimento local. Busca real ESP32 retornou 10 referências Commons; avaliação TypeSafe paga não executada.
- Interface: dois pop-ups implementados. Conferidos no navegador: uso simultâneo, movimento pelo cabeçalho, composição com nota/nó/foto via `@`, anexo TXT local, grade 3×3 e navegação do deck por lateral e roda do mouse. Falha de prévia tem mensagem acessível e conserva a fonte.
- Integração/renderização/chat: implementados. Conferidos: referência como base, clipboard com bytes de imagem, colagem e movimento no canvas, reload e restauração por JSON portátil. Three.js renderizou cena local de QA com fundo transparente e rotação. Imagens são referências textuais, sem análise de pixels; geração real paga não exercitada.
- Verificação automática integrada: 471 testes do aplicativo passaram, 8 testes live ignorados; 14 testes do gateway passaram; TypeScript, sintaxe do gateway e build terminaram com código de saída 0.
- Verificação final no navegador: encerrada com os resultados e limites em [docs/visual-canvas-validation.md](../../visual-canvas-validation.md). Esta entrega não conclui o roteiro amplo de oito tarefas; ZIP, inspector avançado e animador continuam fora do recorte. Sem commit, push ou deploy.
