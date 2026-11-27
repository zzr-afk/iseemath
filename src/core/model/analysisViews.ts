import type { AnalysisView, DatasetMeta, Project } from './types';
import { computeSchemaHash } from '../logs/datasetHash';

/** Column ids an analysis view depends on: filters, groups, metrics, bucket. */
export function viewReferencedColumnIds(view: AnalysisView): string[] {
  const ids = new Set<string>();
  for (const filter of view.filters) ids.add(filter.fieldId);
  for (const columnId of view.groupBy) ids.add(columnId);
  for (const metric of view.metrics) {
    if (metric.fieldId) ids.add(metric.fieldId);
  }
  if (view.timeBucket?.fieldId) ids.add(view.timeBucket.fieldId);
  if (view.chart?.xFieldId) ids.add(view.chart.xFieldId);
  return [...ids];
}

export interface ViewValidationResult {
  broken: boolean;
  reason?: string;
}

export function validateAnalysisView(
  project: Project,
  view: AnalysisView,
): ViewValidationResult {
  const dataset = project.datasets.find((candidate) => candidate.id === view.datasetId);
  if (!dataset) return { broken: true, reason: '数据集不存在' };
  if (dataset.dataUnavailable) return { broken: true, reason: '数据源不可用，请重新导入' };

  const referenced = viewReferencedColumnIds(view);
  for (const columnId of referenced) {
    if (!dataset.columns.some((column) => column.id === columnId)) {
      return { broken: true, reason: `引用的列 ${columnId} 已不存在` };
    }
  }

  const currentHash = computeSchemaHash(dataset.columns, referenced);
  if (currentHash !== view.schemaHash) {
    return { broken: true, reason: '引用列的类型或结构已变化' };
  }
  return { broken: false };
}

/**
 * Mark active views as broken when their dataset/columns no longer match the
 * saved schema hash. Broken views are never auto-restored: repair is explicit.
 */
export function revalidateAnalysisViews(project: Project, datasetId?: string): void {
  for (const view of project.views) {
    if (datasetId && view.datasetId !== datasetId) continue;
    if (view.status !== 'active') continue;
    const result = validateAnalysisView(project, view);
    if (result.broken) {
      view.status = 'broken';
      view.brokenReason = result.reason;
      view.updatedAt = Date.now();
    }
  }
}

/** Recompute the hash a view should store for the dataset's current schema. */
export function expectedViewSchemaHash(
  dataset: DatasetMeta,
  view: AnalysisView,
): string {
  return computeSchemaHash(dataset.columns, viewReferencedColumnIds(view));
}
