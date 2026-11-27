import { importDataset, type ImportDatasetOptions } from '@/core/logs/importDataset';
import type { ImportDatasetResult } from '@/core/logs/importDataset';

export interface LogParseRequest {
  id: number;
  options: ImportDatasetOptions;
}

export type LogParseResponse =
  | { id: number; ok: true; result: ImportDatasetResult }
  | { id: number; ok: false; error: string };

const scope = self as unknown as {
  onmessage: ((event: MessageEvent<LogParseRequest>) => void) | null;
  postMessage: (message: LogParseResponse, transfer?: Transferable[]) => void;
};

function collectBuffers(result: ImportDatasetResult): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  for (const vector of result.table.vectors) {
    if (vector.type === 'number' || vector.type === 'date') {
      buffers.add(vector.values.buffer as ArrayBuffer);
    }
    buffers.add(vector.valid.buffer as ArrayBuffer);
  }
  return [...buffers];
}

scope.onmessage = (event: MessageEvent<LogParseRequest>) => {
  const { id, options } = event.data;
  try {
    const result = importDataset(options);
    const response: LogParseResponse = { id, ok: true, result };
    scope.postMessage(response, collectBuffers(result));
  } catch (error) {
    const response: LogParseResponse = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    scope.postMessage(response);
  }
};
