type Stage = 'selection' | 'plan' | 'module' | 'assembly';
type Code = 'format' | 'references' | 'anchors' | 'scene' | 'budget' | 'bounds' | 'contacts';

/** Safe diagnostics only: never attach provider bodies, image bytes or reference text. */
export class VisualAssemblyError extends Error {
  readonly moduleName?: string;
  constructor(readonly stage: Stage, readonly code: Code, moduleName?: string) {
    super('visualAssemblyInvalid');
    this.name = 'VisualAssemblyError';
    this.moduleName = moduleName?.replace(/[\u0000-\u001f]/g, ' ').slice(0, 160);
  }
}

export function assemblyErrorMessage(error: VisualAssemblyError, en: boolean): string {
  const stages: Record<Stage, string> = en
    ? { selection: 'Reference selection', plan: 'Assembly plan', module: error.moduleName ? `Module “${error.moduleName}”` : 'Module', assembly: 'Final assembly' }
    : { selection: 'Seleção de referências', plan: 'Planejamento da montagem', module: error.moduleName ? `Módulo “${error.moduleName}”` : 'Módulo', assembly: 'Conjunto final' };
  const reasons: Record<Code, string> = en ? {
    format: 'the response did not follow the required format or supported limits.',
    references: 'the response used references that were not selected or available.',
    anchors: 'a planned contact point is outside the envelopes of the parts it connects.',
    scene: 'the geometry contains invalid shapes, transforms or repeated identifiers.',
    budget: 'the geometry exceeded the object or mesh budget reserved for this part.',
    bounds: 'the generated geometry extends beyond this part’s planned spatial limits.',
    contacts: 'a generated part does not reach its planned contact point or names a missing object.',
  } : {
    format: 'a resposta não seguiu o formato ou os limites suportados.',
    references: 'a resposta usou referências que não foram selecionadas ou não estão disponíveis.',
    anchors: 'um ponto de contato planejado está fora dos limites das peças que ele conecta.',
    scene: 'a geometria contém formas, transformações ou identificadores inválidos.',
    budget: 'a geometria ultrapassou o limite de formas ou de malha reservado para esta peça.',
    bounds: 'a geometria gerada ultrapassa os limites de espaço planejados para esta peça.',
    contacts: 'uma peça gerada não alcança seu ponto de contato ou indica um objeto inexistente.',
  };
  return `${stages[error.stage]}: ${reasons[error.code]} ${en ? 'No partial assembly was applied. Review the request or try again.' : 'Nenhuma montagem parcial foi aplicada. Revise o pedido ou tente novamente.'}`;
}
