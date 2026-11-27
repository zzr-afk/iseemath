import { describe, expect, it } from 'vitest';
import { createEmptyProject } from './factories';
import type { AnalysisView, DatasetMeta, Project } from './types';
import { computeSchemaHash } from '../logs/datasetHash';
import {
  revalidateAnalysisViews,
  validateAnalysisView,
  viewReferencedColumnIds,
} from './analysisViews';

function makeDataset(project: Project): DatasetMeta {
  const dataset: DatasetMeta = {
    id: 'ds1',
    name: '日志',
    format: 'csv',
    storage: 'blob',
    blobKey: 'p:1',
    parserVersion: '1',
    rawBytesHash: 'raw',
    parseParamsHash: 'params',
    contentHash: 'content',
    outputDigest: 'digest',
    columns: [
      { id: 'c0:server', name: '区服', type: 'string', sourceIndex: 0 },
      { id: 'c1:damage', name: '伤害', type: 'number', sourceIndex: 1 },
      { id: 'c2:time', name: '时间', type: 'date', sourceIndex: 2 },
    ],
    rowCount: 3,
    datasetHash: 'hash',
    createdAt: 1,
  };
  project.datasets.push(dataset);
  return dataset;
}

function makeView(dataset: DatasetMeta, id = 'v1'): AnalysisView {
  const view: AnalysisView = {
    id,
    name: '按区服',
    datasetId: dataset.id,
    filters: [],
    groupBy: ['c0:server'],
    metrics: [{ id: 'm1', op: 'sum', fieldId: 'c1:damage', alias: '伤害求和' }],
    schemaHash: '',
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
  };
  view.schemaHash = computeSchemaHash(dataset.columns, viewReferencedColumnIds(view));
  return view;
}

describe('analysis view validation', () => {
  it('accepts a view that matches the current schema', () => {
    const project = createEmptyProject();
    const dataset = makeDataset(project);
    const view = makeView(dataset);
    project.views.push(view);

    expect(viewReferencedColumnIds(view).sort()).toEqual(['c0:server', 'c1:damage']);
    expect(validateAnalysisView(project, view)).toEqual({ broken: false });
  });

  it('breaks the view when a referenced column changes type', () => {
    const project = createEmptyProject();
    const dataset = makeDataset(project);
    const view = makeView(dataset);
    project.views.push(view);

    dataset.columns = dataset.columns.map((column) =>
      column.id === 'c1:damage' ? { ...column, type: 'date' } : column,
    );

    const result = validateAnalysisView(project, view);
    expect(result.broken).toBe(true);
    expect(result.reason).toContain('类型');
  });

  it('breaks the view when a referenced column disappears or the dataset is gone', () => {
    const project = createEmptyProject();
    const dataset = makeDataset(project);
    const view = makeView(dataset);
    project.views.push(view);

    dataset.columns = dataset.columns.filter((column) => column.id !== 'c0:server');
    expect(validateAnalysisView(project, view).broken).toBe(true);

    project.datasets = [];
    expect(validateAnalysisView(project, view).reason).toContain('数据集不存在');
  });

  it('marks active views broken but never auto-restores them', () => {
    const project = createEmptyProject();
    const dataset = makeDataset(project);
    const active = makeView(dataset, 'v1');
    const broken = makeView(dataset, 'v2');
    broken.status = 'broken';
    broken.brokenReason = '手工标记';
    project.views.push(active, broken);

    dataset.columns = dataset.columns.filter((column) => column.id !== 'c0:server');
    revalidateAnalysisViews(project);

    expect(active.status).toBe('broken');
    expect(active.brokenReason).toBeTruthy();

    // Restoring the schema must not silently reactivate the view.
    const project2 = createEmptyProject();
    const dataset2 = makeDataset(project2);
    const view2 = makeView(dataset2, 'v3');
    view2.status = 'broken';
    view2.brokenReason = '曾失效';
    project2.views.push(view2);
    revalidateAnalysisViews(project2);
    expect(view2.status).toBe('broken');
    expect(view2.brokenReason).toBe('曾失效');
  });

  it('only revalidates the requested dataset', () => {
    const project = createEmptyProject();
    const dataset = makeDataset(project);
    const view = makeView(dataset);
    project.views.push(view);
    dataset.columns = dataset.columns.filter((column) => column.id !== 'c0:server');

    revalidateAnalysisViews(project, 'other-dataset');
    expect(view.status).toBe('active');
    revalidateAnalysisViews(project, dataset.id);
    expect(view.status).toBe('broken');
  });
});
