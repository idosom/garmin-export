/** Minimal client for a local Ollama server — no server-side component, everything stays on-device. */

export const OLLAMA_HOST = 'http://localhost:11434';
export const OLLAMA_MODEL = 'qwen3:latest';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class OllamaError extends Error {}

/** Streams a chat completion, calling `onDelta` with each new chunk of assistant text. */
export async function streamOllamaChat(messages: ChatMessage[], onDelta: (text: string) => void, signal?: AbortSignal): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${OLLAMA_HOST}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: OLLAMA_MODEL, messages, stream: true }),
      signal,
    });
  } catch {
    throw new OllamaError(
      `Could not reach Ollama at ${OLLAMA_HOST}. Make sure it is running ("ollama serve") and allows requests from this page (OLLAMA_ORIGINS=*).`,
    );
  }

  if (!response.ok || !response.body) {
    throw new OllamaError(`Ollama responded with ${response.status}. Make sure the model is pulled ("ollama pull ${OLLAMA_MODEL}").`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      if (!line.trim()) continue;
      let chunk: { message?: { content?: string }; done?: boolean; error?: string };
      try {
        chunk = JSON.parse(line);
      } catch {
        continue;
      }
      if (chunk.error) throw new OllamaError(chunk.error);
      if (chunk.message?.content) onDelta(chunk.message.content);
    }
  }
}
