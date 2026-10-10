type Stage = 'selection' | 'plan' | 'module' | 'assembly';
type Code = 'format' | 'references' | 'anchors' | 'scene' | 'budget' | 'bounds' | 'contacts';

const sceneFields = new Set(['version', 'label', 'objects', 'id', 'type', 'position', 'rotation', 'scale', 'color', 'geometry',
  'kind', 'points', 'holes', 'depth', 'bevel', 'segments', 'radius', 'radialSegments', 'closed', 'vertices', 'indices']);
const issueReasons = { invalid_type: 'type', too_big: 'maximum', too_small: 'minimum', invalid_format: 'format',
  invalid_value: 'enum', invalid_union: 'union', unrecognized_keys: 'unknown-fields', not_multiple_of: 'multiple',
  invalid_key: 'key', invalid_element: 'element', custom: 'validation' } as const;
const knownReasons = { visualGeometryInvalid: 'invalid-geometry', duplicateObjectId: 'duplicate-id',
  visualGeometryBudgetExceeded: 'triangle-budget' } as const;
type SafeIssueCode = keyof typeof issueReasons | 'validation';
type SafeIssueReason = typeof issueReasons[keyof typeof issueReasons] | typeof knownReasons[keyof typeof knownReasons];
export interface SceneValidationFailure {
  scene: unknown;
  issues: readonly { code: string; path: readonly PropertyKey[]; message?: string }[];
}
export interface AssemblySceneDiagnostics {
  readonly objectCount: number;
  readonly inspectedObjectCount: number;
  readonly customObjectCount: number;
  readonly issueCount: number;
  readonly omittedIssueCount: number;
  readonly issues: readonly { readonly path: readonly (string | number)[]; readonly code: SafeIssueCode; readonly reason: SafeIssueReason }[];
}

/** No raw Zod messages/values: unexpected paths and codes become fixed tokens. */
function sceneDiagnostics(failure: SceneValidationFailure): AssemblySceneDiagnostics {
  const raw = failure.scene && typeof failure.scene === 'object' ? (failure.scene as { objects?: unknown }).objects : undefined;
  const objects: unknown[] = Array.isArray(raw) ? raw : [], inspected = objects.slice(0, 512);
  const issues = failure.issues.slice(0, 12).map(issue => {
    const code: SafeIssueCode = Object.hasOwn(issueReasons, issue.code) ? issue.code as keyof typeof issueReasons : 'validation';
    const reason: SafeIssueReason = issue.message && Object.hasOwn(knownReasons, issue.message)
      ? knownReasons[issue.message as keyof typeof knownReasons] : code === 'validation' ? 'validation' : issueReasons[code];
    const path = issue.path.slice(0, 8).map(part => typeof part === 'string' && sceneFields.has(part) ? part
      : typeof part === 'number' && Number.isSafeInteger(part) && part >= 0 && part <= 1_000_000 ? part : '?');
    return Object.freeze({ path: Object.freeze(path), code, reason });
  });
  return Object.freeze({ objectCount: objects.length, inspectedObjectCount: inspected.length,
    customObjectCount: inspected.filter(object => object && typeof object === 'object' && (object as { type?: unknown }).type === 'custom').length,
    issueCount: failure.issues.length, omittedIssueCount: Math.max(0, failure.issues.length - issues.length), issues: Object.freeze(issues) });
}

/** Safe diagnostics only: never attach provider bodies, image bytes or reference text. */
export class VisualAssemblyError extends Error {
  readonly moduleName?: string;
  readonly sceneDiagnostics?: AssemblySceneDiagnostics;
  constructor(readonly stage: Stage, readonly code: Code, moduleName?: string, sceneFailure?: SceneValidationFailure) {
    super('visualAssemblyInvalid');
    this.name = 'VisualAssemblyError';
    this.moduleName = moduleName?.replace(/[\u0000-\u001f]/g, ' ').slice(0, 160);
    this.sceneDiagnostics = sceneFailure ? sceneDiagnostics(sceneFailure) : undefined;
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
