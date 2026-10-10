import { NoObjectGeneratedError } from 'ai';
import { VisualAssemblyError } from './advancedErrors';

/** SDK output validation precedes local validation; retain its stage, never its payload. */
export async function withAssemblyStage<T>(stage: VisualAssemblyError['stage'], moduleName: string | undefined, request: () => Promise<T>): Promise<T> {
  try {
    return await request();
  } catch (error) {
    if (!NoObjectGeneratedError.isInstance(error)) throw error;
    if (error.finishReason === 'length') throw new Error('visualGenerationIncomplete');
    throw new VisualAssemblyError(stage, 'format', moduleName);
  }
}
