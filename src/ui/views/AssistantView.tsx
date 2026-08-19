import { useEffect, useMemo, useRef, useState } from 'react';
import { useDataset } from '../../state/dataset.tsx';
import { useSettings } from '../../state/settings.tsx';
import { streamOllamaChat, OllamaError, OLLAMA_MODEL, type ChatMessage } from '../../ai/ollama.ts';
import { buildDatasetContext, ASSISTANT_SYSTEM_PROMPT } from '../../ai/context.ts';
import { Card, Alert, EmptyState } from '../components/primitives.tsx';
import { IconChat, IconSend } from '../components/icons.tsx';

interface Turn {
  role: 'user' | 'assistant';
  content: string;
}

const SUGGESTIONS = ['How is my training trending this month?', 'Which activity had the biggest HR effort?', 'How is my sleep looking lately?'];

export function AssistantView() {
  const { dataset, overview } = useDataset();
  const { units } = useSettings();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const endRef = useRef<HTMLDivElement | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [turns]);

  const context = useMemo(() => buildDatasetContext(dataset, overview, units), [dataset, overview, units]);

  async function send(question: string) {
    const text = question.trim();
    if (!text || busy) return;
    setError(undefined);
    setInput('');
    const next: Turn[] = [...turns, { role: 'user', content: text }, { role: 'assistant', content: '' }];
    setTurns(next);
    setBusy(true);

    const history: ChatMessage[] = [
      { role: 'system', content: `${ASSISTANT_SYSTEM_PROMPT}\n\nData summary:\n${context}` },
      ...next.slice(0, -1).map((t) => ({ role: t.role, content: t.content }) as ChatMessage),
    ];

    try {
      await streamOllamaChat(history, (delta) => {
        if (!mounted.current) return;
        setTurns((current) => {
          const copy = current.slice();
          const last = copy[copy.length - 1];
          copy[copy.length - 1] = { ...last, content: last.content + delta };
          return copy;
        });
      });
    } catch (err) {
      if (!mounted.current) return;
      setError(err instanceof OllamaError ? err.message : 'Something went wrong talking to Ollama.');
      setTurns((current) => current.slice(0, -1));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  return (
    <Card title="Ask about your data" note={`Local model via Ollama · ${OLLAMA_MODEL}`} padded={false}>
      <div className="chat-log">
        {turns.length === 0 && (
          <EmptyState
            icon={<IconChat size={20} />}
            title="Ask a question about your training or health data"
            description="Runs entirely on your machine through a local Ollama server — nothing leaves your computer."
            action={
              <div className="chat-suggestions">
                {SUGGESTIONS.map((s) => (
                  <button key={s} type="button" className="btn ghost small" onClick={() => send(s)}>
                    {s}
                  </button>
                ))}
              </div>
            }
          />
        )}
        {turns.map((turn, i) => (
          <div key={i} className={`chat-turn ${turn.role}`}>
            <div className="chat-bubble">{turn.content || (busy && i === turns.length - 1 ? '…' : '')}</div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      {error && (
        <div className="chat-error">
          <Alert kind="error">{error}</Alert>
        </div>
      )}

      <form
        className="chat-input-row"
        onSubmit={(event) => {
          event.preventDefault();
          send(input);
        }}
      >
        <textarea
          className="input chat-input"
          placeholder="Ask about your activities, training load, sleep…"
          rows={1}
          value={input}
          disabled={busy}
          onChange={(event) => setInput(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send(input);
            }
          }}
        />
        <button type="submit" className="btn primary" disabled={busy || !input.trim()}>
          <IconSend size={14} /> Send
        </button>
      </form>
    </Card>
  );
}
