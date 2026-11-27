import Dexie, { type Table } from 'dexie';
import type { ComparisonRunMeta, Project, ProjectViewState } from '@/core/model/types';

export interface ProjectRow {
  id: string;
  doc: Project;
  docRevision: number;
  updatedAt: number;
  schemaVersion: 1;
}

export interface ProjectViewRow {
  projectId: string;
  viewState: ProjectViewState;
  viewRevision: number;
  updatedAt: number;
  schemaVersion: 1;
}

export interface LeaseRow {
  projectId: string;
  leaseToken: number;
  leaderTabId: string;
  leaderHeartbeatAt: number;
}

export interface DraftRow {
  id: string;
  projectId: string;
  tabId: string;
  doc: Project;
  baseRevision: number;
  savedAt: number;
}

export interface ComparisonRunRow extends ComparisonRunMeta {
  id?: number;
  projectId: string;
}

export interface PendingBlobGcRow {
  id?: number;
  projectId: string;
  datasetId: string;
  blobKey: string;
  enqueuedAt: number;
}

export interface PendingManualGcRow {
  id?: number;
  projectId: string;
  datasetId: string;
  enqueuedAt: number;
  reason: 'removed' | 'storage-changed';
}

export interface ProjectCopyRow {
  projectId: string;
  sourceProjectId: string;
  startedAt: number;
  state: 'copying' | 'done';
  baseDocRevision: number;
  sourceLeaseToken: number;
}

export interface CopyItemRow {
  projectId: string;
  datasetId: string;
  state: 'copying' | 'done' | 'skipped';
  rawBytesHash?: string;
  rowCount?: number;
  outputDigest?: string;
}

export interface ManualRowsStagingRow {
  projectId: string;
  datasetId: string;
  columns: unknown;
  rows: unknown;
  rowCount: number;
  outputDigest: string;
  datasetHash: string;
  commitToken: number;
  updatedAt: number;
}

export interface LeaseCandidateRow {
  projectId: string;
  tabId: string;
  at: number;
}

export interface BlobMetaRow {
  key: string;
  projectId: string;
  byteLength: number;
  chunkCount: number;
  mime: string;
  createdAt: number;
}

export interface BlobChunkRow {
  blobKey: string;
  index: number;
  data: ArrayBuffer;
}

export class IseeMathDatabase extends Dexie {
  projects!: Table<ProjectRow, string>;
  projectViews!: Table<ProjectViewRow, string>;
  leases!: Table<LeaseRow, string>;
  drafts!: Table<DraftRow, string>;
  comparisonRuns!: Table<ComparisonRunRow, number>;
  pendingBlobGc!: Table<PendingBlobGcRow, number>;
  pendingManualGc!: Table<PendingManualGcRow, number>;
  projectCopies!: Table<ProjectCopyRow, string>;
  copyItems!: Table<CopyItemRow, [string, string]>;
  manualRowsStaging!: Table<ManualRowsStagingRow, [string, string]>;
  leaseCandidates!: Table<LeaseCandidateRow, [string, string]>;
  blobMeta!: Table<BlobMetaRow, string>;
  blobChunks!: Table<BlobChunkRow, [string, number]>;

  constructor() {
    super('iseemath');
    this.version(1).stores({
      projects: 'id, updatedAt',
      projectViews: 'projectId',
      leases: 'projectId',
      drafts: 'id, projectId, savedAt',
      comparisonRuns: '++id, projectId, comparisonId',
      pendingBlobGc: '++id, projectId, blobKey',
      pendingManualGc: '++id, projectId, datasetId',
      projectCopies: 'projectId, sourceProjectId, state, startedAt',
      copyItems: '[projectId+datasetId], projectId',
      manualRowsStaging: '[projectId+datasetId], projectId',
      leaseCandidates: '[projectId+tabId], projectId',
    });
    this.version(2).stores({
      blobMeta: 'key, projectId',
      blobChunks: '[blobKey+index], blobKey',
    });
  }
}

export const db = new IseeMathDatabase();

export function indexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined';
}
