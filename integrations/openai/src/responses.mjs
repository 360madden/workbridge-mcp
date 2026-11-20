import { CompanionError } from './config.mjs';

export async function createOpenAIClient(apiKey) {
  if (!apiKey || !apiKey.trim()) {
    throw new CompanionError('MISSING_API_KEY', 'OPENAI_API_KEY is not configured for the local process.');
  }
  const { default: OpenAI } = await import('openai');
  return new OpenAI({
    apiKey,
    maxRetries: 0, // A chargeable request is never retried automatically.
    timeout: 30_000,
  });
}

export async function executeSingleResponse({ client, request, clock = Date.now }) {
  if (!client || typeof client.responses?.create !== 'function') {
    throw new CompanionError('INVALID_CLIENT', 'OpenAI Responses client is unavailable.');
  }
  const start = clock();
  let response;
  try {
    response = await client.responses.create(request);
  } catch (error) {
    // Never echo provider request bodies, headers, tokens or raw error messages.
    const status = Number.isInteger(error?.status) ? error.status : null;
    const failure = new CompanionError(
      'OPENAI_REQUEST_FAILED',
      'The OpenAI API request failed; inspect account or connectivity.',
    );
    failure.status = status;
    throw failure;
  }
  if (typeof response?.id !== 'string' || !response.id) {
    throw new CompanionError('INVALID_API_RESPONSE', 'OpenAI returned no response identifier.');
  }
  const output = typeof response.output_text === 'string' ? response.output_text : '';
  const maxOutputChars = 12000;
  const usage = response.usage ?? {};
  const tokenCount = (number) => (Number.isSafeInteger(number) && number >= 0 ? number : null);
  return {
    responseId: response.id,
    model: response.model ?? request.model,
    status: response.status ?? 'unknown',
    elapsedMs: Math.max(0, clock() - start),
    usage: {
      inputTokens: tokenCount(usage.input_tokens),
      outputTokens: tokenCount(usage.output_tokens),
      totalTokens: tokenCount(usage.total_tokens),
    },
    output: output.slice(0, maxOutputChars),
    outputTruncated: output.length > maxOutputChars,
  };
}
