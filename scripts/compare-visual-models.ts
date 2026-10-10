/** Explicit, paid, local comparison. Never runs as part of npm test/build.
 * Run: npx vite-node --mode test scripts/compare-visual-models.ts --run
 * OPENROUTER is read from the local environment; no keys/headers are written.
 */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadEnv } from 'vite';
import { generateObject } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { BASELINE_VISUAL_SYSTEM, buildLegacyVisualModelSystem as buildVisualModelSystem, LEGACY_VISUAL_MODEL_GUIDE_VERSION as VISUAL_MODEL_GUIDE_VERSION } from '../src/visuals/modelingGuide';
import { generationSceneSchema, sceneSchema } from '../src/visuals/comparison/legacyScene';

const destination = resolve('docs/design/three-skills-comparison');
const outputFile = resolve(destination, 'comparison.json');
const prompt = 'Crie uma representação 3D ilustrativa de uma placa de desenvolvimento ESP32, isolada e sem fundo, com seus componentes principais reconhecíveis. Não use medidas físicas exatas sem fonte.';
const model = 'openai/gpt-6.1-sol';
const maxOutputTokens = 10_000;
const upstreamCommit = 'b1c623076c661fc9b03dac19292e825a5d106823';
class ComparisonSetupError extends Error {}

async function main() {
  if (!process.argv.includes('--run')) throw new ComparisonSetupError('Use --run para autorizar explicitamente as duas chamadas pagas.');
  for (const name of ['comparison.json', 'baseline.json', 'skills.json']) {
    try {
      await access(resolve(destination, name));
      throw new ComparisonSetupError(`Já existe ${name}. Preserve a amostra original; escolha outro diretório para uma nova execução.`);
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }

  const env = loadEnv('development', process.cwd(), '');
  const apiKey = process.env.OPENROUTER || env.OPENROUTER;
  if (!apiKey) throw new ComparisonSetupError('OPENROUTER não está configurado no ambiente local.');
  const client = createOpenRouter({ apiKey, appName: 'dynamic_diary visual comparison' });
  const runs = [];
  const conditions = [
    { condition: 'baseline', label: 'Sem guia de skills', system: BASELINE_VISUAL_SYSTEM },
    { condition: 'skills', label: 'Com guia de skills', system: buildVisualModelSystem(prompt) },
  ] as const;
  await mkdir(destination, { recursive: true });
  for (const variant of conditions) {
    console.log(`Gerando ${variant.condition} com ${model}…`);
    const started = performance.now();
    const result = await generateObject({
      model: client.chat(model, { reasoning: { effort: 'medium' } }),
      schema: generationSceneSchema,
      system: variant.system,
      prompt: JSON.stringify({ instruction: prompt, context: '' }),
      maxOutputTokens, maxRetries: 0,
      abortSignal: AbortSignal.timeout(180_000),
    });
    if (result.finishReason === 'length') throw new ComparisonSetupError(`${variant.condition}: resposta incompleta; amostra rejeitada.`);
    const scene = sceneSchema.parse(result.object);
    const run = {
      condition: variant.condition, label: variant.label, scene,
      durationMs: Math.round(performance.now() - started),
      finishReason: result.finishReason, usage: result.usage,
      systemPrompt: variant.system,
      responseId: result.response.id,
    };
    runs.push(run);
    // Preserve each first result even if the second request fails. No reranking.
    await writeFile(resolve(destination, `${variant.condition}.json`), JSON.stringify(run, null, 2) + '\n');
    console.log(`${variant.condition}: ${scene.objects.length} primitivas válidas; ${run.durationMs} ms.`);
  }
  const comparison = {
    version: 1, createdAt: new Date().toISOString(), provider: 'openrouter', model,
    prompt, temperature: null, maxOutputTokens, reasoningEffort: 'medium',
    skillRevision: VISUAL_MODEL_GUIDE_VERSION, upstreamCommit,
    order: ['baseline', 'skills'], runs,
    notes: [
      'Duas respostas reais: a primeira geração válida de cada condição, sem edição manual dos objetos.',
      'Mesma instrução, contexto vazio, modelo, raciocínio medium, schema, orçamento e renderizador. A intervenção é o system prompt adaptado.',
      'Temperature omitida nas duas chamadas porque este é o modelo de raciocínio usado como padrão no aplicativo.',
      'Uma amostra por condição; sem seed fixada ou avaliação cega. A variação do modelo também pode influenciar o resultado.',
      'As formas são ilustrativas, sem análise de pixels, medições verificadas ou validação física. Quantidade de primitivas não mede qualidade.',
      'O guia combina conhecimento das skills com regras e receitas próprias do projeto; não isola o efeito do texto upstream puro.',
    ],
  };
  await writeFile(outputFile, JSON.stringify(comparison, null, 2) + '\n');
  console.log('Comparação salva em docs/design/three-skills-comparison/comparison.json.');
}

main().catch(error => {
  // SDK errors may carry request headers: never dump the error object/cause.
  console.error(error instanceof ComparisonSetupError
    ? error.message
    : 'A geração falhou. Nenhuma chave ou cabeçalho foi registrado.');
  process.exitCode = 1;
});
