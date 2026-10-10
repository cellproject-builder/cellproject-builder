const ingestions = new Set<symbol>();
export function registerDataIngestion() {
  const id = Symbol('data-ingestion'); ingestions.add(id);
  return () => { ingestions.delete(id); };
}
export const hasActiveDataIngestions = () => ingestions.size > 0;
export function assertDataTransitionIdle(chatRunning: boolean, plannerRunning: boolean) {
  if (chatRunning || plannerRunning || hasActiveDataIngestions()) throw new Error('Aguarde o chat, as operações de IA e a leitura dos anexos terminarem antes de copiar, trocar os dados ou encerrar a sessão.');
}
