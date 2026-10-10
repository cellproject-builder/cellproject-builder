# Encrypted Offline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reabrir e editar notas, planos e desenhos cifrados no aparelho e retomar o envio ao reconectar.

**Architecture:** Um repositório IndexedDB armazena checkpoints cifrados e independentes do runtime e do transporte. A fila é persistida antes do envio; o transporte persiste seu ciphertext antes do PUT e sua confirmação antes de responder ao runtime. O bootstrap só prepara offline após autenticação real, usa exclusão mútua entre abas e confirma a conta antes de reconectar.

**Tech Stack:** TypeScript, React, IndexedDB, Web Crypto AES-GCM, Web Locks, Vitest.

**Spec:** `docs/superpowers/specs/2026-10-10-encrypted-offline.md`

## Global Constraints

- Sem novas dependências, sem armazenamento de senha, sem fallback para o IndexedDB legado legível.
- Não alterar autenticação, tabelas ou políticas do Supabase.
- Preservar ciphertext e operationId de solicitações ambíguas.
- Novos uploads exigem rede; leitura offline somente dos arquivos cifrados já consultados.

## Review Focus

- Resposta de PUT perdida entre confirmação remota e persistência do runtime: replay idêntico.
- Duas abas e logout concorrente: somente um dono do diário e autorização offline revogada.
- Quota/corrupção: não abrir dados parcialmente validados nem anunciar salvamento inexistente.
- Mudança remota de cofre/conta: não enviar rascunhos do proprietário anterior.
- Edição nos dois aparelhos: preservar conflito sem sobrescrever a versão remota.

### Task 1: Repositório cifrado e exclusão mútua

**Files:** criar `src/cloud/offline/repository.ts` e testes.

**Interfaces:** `OfflineRepository(session)` com `read<T>(slot)`, `write(slot, value)`, `remove(slot)`; slots vinculados à conta/cofre pelo AAD. Funções de autorização persistem somente metadados públicos necessários e revogam a abertura offline no logout. `acquireOfflineLease(ownerId, vaultId)` retorna liberação ou null se ocupado/indisponível.

- [ ] Criar regressões de cifragem, troca de owner/cofre, corrupção, quota, autorização/revogação e lock.
- [ ] Observar falhas antes da implementação.
- [ ] Implementar transações atômicas e falhas explícitas.
- [ ] Executar testes focados e verificar tipos.

### Task 2: Checkpoints e retomada do runtime/transporte

**Files:** `src/cloud/runtime.ts`, `src/cloud/vault/transport.ts`, testes e pequeno adaptador offline.

**Interfaces:** persistência opcional injetada; construtores existentes continuam compatíveis. Checkpoint do runtime contém confirmed/drafts/queue; checkpoint do transporte contém head/pending/receipts/fingerprints. O runtime distingue pendência remota de gravação local.

- [ ] Reproduzir perda de rascunho após reload e resposta ambígua sem replay durável.
- [ ] Persistir fila antes de enviar, ciphertext antes de PUT e confirmação antes de responder.
- [ ] Restaurar e validar checkpoints sem enviar antes da confirmação de conta.
- [ ] Testar replay idêntico, falha local, conflito e arquivos já lidos.

### Task 3: Bootstrap, reconexão e estado visível

**Files:** `src/cloud/CloudBootstrap.tsx`, `CloudStatus.tsx`, `CloudLiveSync.tsx`, adaptador offline e testes.

- [ ] Testar offline sem preparo, reabertura autorizada, bloqueio de outra aba e logout.
- [ ] Preparar checkpoint após verificar conta; permitir reabertura local somente por autorização anterior e chave validada.
- [ ] Confirmar conta e cabeçalho ao reconectar antes do retry; sinalizar salvo no aparelho, sincronizando ou conflito de forma discreta.
- [ ] Validar com navegador, lint, suíte, build e revisão independente; registrar limites e ensaio físico pendente.
