import { useCallback, useEffect, useRef, useState } from 'react';
import type { Dataset } from '../core/types.ts';
import type { IngestProgress } from '../ingest/pipeline.ts';
import type { WorkerRequest, WorkerResponse } from '../worker/parse.worker.ts';

export interface FileInput {
  path: string;
  file: File;
}

export type IngestStatus = 'idle' | 'working' | 'ready' | 'error';

export interface IngestState {
  status: IngestStatus;
  progress?: IngestProgress;
  dataset?: Dataset;
  error?: string;
}

export function useIngest() {
  const [state, setState] = useState<IngestState>({ status: 'idle' });
  const workerRef = useRef<Worker | null>(null);

  useEffect(
    () => () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    },
    [],
  );

  const start = useCallback(async (files: FileInput[], label?: string) => {
    if (!files.length) return;
    setState({ status: 'working', progress: { phase: 'reading', processed: 0, total: files.length } });

    const finish = (dataset: Dataset) => setState({ status: 'ready', dataset });
    const fail = (message: string) => setState({ status: 'error', error: message });

    try {
      workerRef.current?.terminate();
      const worker = new Worker(new URL('../worker/parse.worker.ts', import.meta.url), { type: 'module' });
      workerRef.current = worker;
      worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
        const message = event.data;
        if (message.type === 'progress') setState((prev) => ({ ...prev, status: 'working', progress: message.progress }));
        else if (message.type === 'done') finish(message.dataset);
        else fail(message.message);
      };
      worker.onerror = (event) => fail(event.message || 'The parser worker failed');
      worker.postMessage({ type: 'ingest', files, label } satisfies WorkerRequest);
    } catch {
      // Workers are unavailable (older browser, blocked module worker): parse
      // on the main thread instead so the app still works.
      try {
        const { ingest } = await import('../ingest/pipeline.ts');
        const dataset = await ingest(
          files.map(({ path, file }) => ({
            path,
            size: file.size,
            read: async () => new Uint8Array(await file.arrayBuffer()),
          })),
          { label, onProgress: (progress) => setState((prev) => ({ ...prev, status: 'working', progress })) },
        );
        finish(dataset);
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
      }
    }
  }, []);

  const reset = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setState({ status: 'idle' });
  }, []);

  const adopt = useCallback((dataset: Dataset) => setState({ status: 'ready', dataset }), []);

  return { ...state, start, reset, adopt };
}

/** Flattens a drag-and-drop payload, walking directories when the browser allows. */
export async function filesFromDataTransfer(transfer: DataTransfer): Promise<FileInput[]> {
  const entries: FileSystemEntry[] = [];
  const plain: FileInput[] = [];

  if (transfer.items && typeof transfer.items[0]?.webkitGetAsEntry === 'function') {
    for (const item of Array.from(transfer.items)) {
      const entry = item.webkitGetAsEntry?.();
      if (entry) entries.push(entry);
      else if (item.kind === 'file') {
        const file = item.getAsFile();
        if (file) plain.push({ path: file.name, file });
      }
    }
  }
  if (entries.length) {
    const collected: FileInput[] = [];
    for (const entry of entries) await walkEntry(entry, '', collected);
    return collected;
  }
  if (plain.length) return plain;
  return Array.from(transfer.files ?? []).map((file) => ({ path: file.name, file }));
}

async function walkEntry(entry: FileSystemEntry, prefix: string, out: FileInput[], depth = 0): Promise<void> {
  if (depth > 12 || out.length > 60000) return;
  if (entry.isFile) {
    const file = await new Promise<File | undefined>((resolve) =>
      (entry as FileSystemFileEntry).file(resolve, () => resolve(undefined)),
    );
    if (file) out.push({ path: `${prefix}${entry.name}`, file });
    return;
  }
  if (!entry.isDirectory) return;
  const reader = (entry as FileSystemDirectoryEntry).createReader();
  for (;;) {
    const batch = await new Promise<FileSystemEntry[]>((resolve) => reader.readEntries(resolve, () => resolve([])));
    if (!batch.length) break;
    for (const child of batch) await walkEntry(child, `${prefix}${entry.name}/`, out, depth + 1);
  }
}

/** Files chosen through an `<input type="file">`, preserving folder structure. */
export function filesFromInput(list: FileList | null): FileInput[] {
  return Array.from(list ?? []).map((file) => ({
    path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
    file,
  }));
}
