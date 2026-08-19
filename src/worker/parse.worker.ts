/// <reference lib="webworker" />
/**
 * Parsing runs off the main thread so a 2 GB export never freezes the UI.
 * The worker owns the whole pipeline and streams progress back.
 */
import { ingest, type IngestProgress, type IngestSource } from '../ingest/pipeline.ts';
import type { Dataset } from '../core/types.ts';

export interface WorkerFileInput {
  path: string;
  file: File;
}

export type WorkerRequest = { type: 'ingest'; files: WorkerFileInput[]; label?: string };

export type WorkerResponse =
  | { type: 'progress'; progress: IngestProgress }
  | { type: 'done'; dataset: Dataset }
  | { type: 'error'; message: string };

const scope = self as unknown as DedicatedWorkerGlobalScope;

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type !== 'ingest') return;
  try {
    const sources: IngestSource[] = message.files.map(({ path, file }) => ({
      path,
      size: file.size,
      read: async () => new Uint8Array(await file.arrayBuffer()),
    }));
    const dataset = await ingest(sources, {
      label: message.label,
      onProgress: (progress) => scope.postMessage({ type: 'progress', progress } satisfies WorkerResponse),
    });
    scope.postMessage({ type: 'done', dataset } satisfies WorkerResponse);
  } catch (error) {
    scope.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : String(error),
    } satisfies WorkerResponse);
  }
};
