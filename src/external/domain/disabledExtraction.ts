/** Browser PDF parsing is deliberately outside deterministic domain execution. */
export async function extractPdfText(): Promise<never> { throw new Error('external_binary_extraction_not_supported'); }
