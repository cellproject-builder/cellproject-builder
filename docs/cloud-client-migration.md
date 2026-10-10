# Dynamic Diary — dados e migração no cliente

O bootstrap consulta `/api/cloud/config` antes de importar o App ou qualquer store persistida. Com cloud desativado explicitamente, os adapters locais continuam funcionando. Com cloud ativado, falhas de autenticação/configuração/snapshot impedem a abertura; não ocorre fallback silencioso para dados locais.

O login usa link de acesso quando o servidor declara `authMethod: "email_link"`. A interface orienta abrir o link no mesmo navegador e permite solicitar outro. O código numérico continua disponível como alternativa opcional. Sessão e tokens pertencem ao backend; o cliente não armazena tokens Supabase nem recebe chaves dos provedores. Os modelos de IA continuam configuráveis conforme as capacidades informadas pelo servidor.

## Backup e primeiro acesso

Na origem de desenvolvimento (`http://127.0.0.1:5190/`), abrir as preferências e selecionar **Exportar backup global (.zip)**. O pacote inclui os seis envelopes completos Zustand, três preferências de interface e todos os registros de arquivos originais. Preserva IDs, vínculos, anexos, propostas, arquivos de referência e campos futuros; exclui as chaves estruturadas de API na configuração.

Uma origem nova não consegue ler o IndexedDB de localhost. Depois do login remoto, o primeiro acesso com documentos vazios sempre oferece **Abrir backup global (.zip)** antes de carregar o App. É possível importar o pacote exportado ou começar sem importar por escolha explícita.

O formato interno permanece `cellproject-global-backup`, versão 1, por compatibilidade. O nome público do download é `dynamic-diary-backup-AAAA-MM-DD.zip`. `manifest.json` contém envelopes e metadados; os bytes ficam em `media/<id>`. SHA-256 verifica cada arquivo e o manifesto. As configurações e os arquivos locais nunca são removidos pela migração.

Antes de importar, o cliente confere o snapshot remoto. Documentos ou metadados existentes divergentes interrompem a importação antes dos uploads. A proteção transacional do servidor continua sendo necessária para alterações simultâneas entre essa leitura e o commit. Depois do envio, o cliente lê de volta os documentos, catálogo e bytes e confere a equivalência. Backups apenas com arquivos também são aceitos.

Em uma sessão remota já aberta, **Baixar cópia atual e importar backup** primeiro captura o editor, descarrega as filas e oferece uma cópia atual. Depois abre o mesmo fluxo de importação. Dados divergentes continuam sendo recusados; não há sobrescrita por data do dispositivo.

## Gravação e recuperação

A nuvem é canônica. O navegador mantém snapshot, rascunhos e bytes lidos somente em memória nessa modalidade. Cada gravação usa revisão confirmada e operationId. Alterações consecutivas ainda não enviadas da mesma chave são agrupadas; uma operação já enviada mantém corpo e identidade intactos para retry após uma resposta perdida. As stores de workspace e chat enviam os rascunhos diretamente a essa fila, evitando uma segunda fila de envelopes.

Conflito, sessão expirada e falha de conexão são visíveis no status global. Rascunhos permanecem na aba. Em falha de conexão há retry; em conflito a interface exige uma cópia completa da sessão antes de permitir reabrir os dados remotos. O backup usa os rascunhos atuais, além de todos os arquivos remotos verificáveis. Fechar a aba com gravações ou debounce pendentes aciona o aviso do navegador.

Exportar, reabrir os dados, sair da sessão ou iniciar uma importação recusa a operação enquanto o chat, a IA ou uma ingestão de arquivos estiverem trabalhando. As ingestões abrangem a leitura de anexos, PDFs da base e mídia do canvas. A saída mantém o adapter cloud fechado até recarregar o bootstrap, evitando qualquer escrita tardia no IndexedDB legado. Não existe coleta automática de arquivos remotos pelo cliente: ela dependerá de validação de referências no servidor.

Respostas 401/403 dos SDKs, busca visual e APIs cloud notificam o mesmo status de sessão, preservando os rascunhos e sem repetir chamadas pagas. Se a sessão expirar com originais ainda não carregados, o backup completo pode ficar indisponível. **Baixar rascunhos de resgate (.json)** então exporta os documentos atuais, mídia já disponível e os metadados/IDs dos arquivos faltantes, sem depender de autenticação. Esse formato tem `complete:false`, nome de resgate e explicação explícita: é um pacote parcial para recuperação manual, não um backup global importável. Reabrir após o resgate continua sujeito à verificação de operações ativas.

O caminho principal de recuperação da sessão mantém esta aba aberta: **Entrar novamente em outra aba** abre o acesso no mesmo navegador. Depois, **Retomar salvamento nesta aba** confirma a identidade original por `/api/cloud/config` e retoma somente a fila de persistência, com os mesmos corpos/operationIds. A recuperação não lê outro snapshot sobre os rascunhos e não repete pedidos pagos. Outra identidade é recusada; revisão remota alterada continua sendo conflito CAS. O resgate parcial fica como alternativa quando não for possível reautenticar.

## Evidência e limites

Os testes dirigidos cobrem login antes da hidratação, modo local, nove documentos e bytes originais, integridade de ZIP/manifesto, preflight, readback incompleto, conflito, retry com corpo idêntico, seleção de modelos sem chave e 100 edições reais agrupadas em dois uploads. O build, login real, migração dos dados do usuário, restauração e deployment são verificados separadamente pelo coordenador.

O pacote de backup é preparado em memória; o limite agregado de arquivos é 500 MiB. Não há promessa de IA offline, sincronização offline persistente ou merge automático de conflitos. A importação dos documentos é transacional no servidor, mas os arquivos são enviados antes e operações interrompidas podem deixar objetos órfãos, sem apagar os originais.
