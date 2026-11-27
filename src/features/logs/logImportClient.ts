import type { ImportDatasetOptions, ImportDatasetResult } from '@/core/logs/importDataset';
import type { LogParseRequest, LogParseResponse } from '@/workers/log.worker';

/** Files above this size are parsed off the main thread. */
export const WORKER_PARSE_THRESHOLD = 1024 * 1024;

interface PendingRequest {
  resolve: (result: ImportDatasetResult) => void;
  reject: (error: Error) => void;
}

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, PendingRequest>();

function rejectAll(error: Error): void {
  for (const request of pending.values()) request.reject(error);
  pending.clear();
  worker?.terminate();
  worker = null;
}

function ensureWorker(): Worker {
  if (worker) return worker;
  const instance = new Worker(new URL('../../workers/log.worker.ts', import.meta.url), {
    type: 'module',
    name: 'log-parser',
  });
  instance.onmessage = (event: MessageEvent<LogParseResponse>) => {
    const message = event.data;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.ok) request.resolve(message.result);
    else request.reject(new Error(message.error));
  };
  instance.onerror = (event) => {
    rejectAll(new Error(event.message || '日志解析线程异常退出'));
  };
  worker = instance;
  return instance;
}

export function parseInWorker(options: ImportDatasetOptions): Promise<ImportDatasetResult> {
  const instance = ensureWorker();
  const id = nextId++;
  return new Promise<ImportDatasetResult>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    const request: LogParseRequest = { id, options };
    instance.postMessage(request);
  });
}

export function disposeLogParser(): void {
  rejectAll(new Error('日志解析线程已关闭'));
}
