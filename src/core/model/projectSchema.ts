import { z } from 'zod';
import type { Project } from './types';

export const MAX_NODES = 10_000;
export const MAX_RELATIONS = 50_000;
export const MAX_BUNDLES = 500;
export const MAX_FORMULA_LENGTH = 8 * 1024;
export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;

const idSchema = z.string().min(1).max(64);
const vec2Schema = z.object({ x: z.number().finite(), y: z.number().finite() });

const nodeBaseSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(128),
  label: z.string().max(256),
  description: z.string().max(4096).optional(),
  tags: z.array(z.string().max(64)).max(64),
  parentId: idSchema.nullable(),
  position: vec2Schema,
  color: z.string().max(32).optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

const curveSchema = z.object({
  points: z
    .array(z.object({ x: z.number().finite(), y: z.number().finite() }))
    .max(2000),
  interpolation: z.enum(['linear', 'step', 'monotone']),
  extrapolation: z.enum(['clamp', 'extend', 'error']),
});

const tableSchema = z.object({
  keyColumn: z.string(),
  columns: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      type: z.enum(['number', 'string']),
    }),
  ),
  rows: z.array(z.array(z.union([z.number(), z.string()]))).max(5000),
  lookup: z.enum(['exact', 'linear']),
});

const variableNodeSchema = nodeBaseSchema.extend({
  kind: z.literal('variable'),
  variableKind: z.enum(['constant', 'formula', 'curve', 'table']),
  role: z.enum(['input', 'intermediate', 'output']),
  unit: z.string().max(32).optional(),
  precision: z.number().int().min(0).max(12).optional(),
  value: z.number().finite().optional(),
  formula: z.string().max(MAX_FORMULA_LENGTH).optional(),
  curve: curveSchema.optional(),
  table: tableSchema.optional(),
});

const groupNodeSchema = nodeBaseSchema.extend({
  kind: z.literal('group'),
});

const fieldDefSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(128),
  label: z.string().max(256),
  type: z.enum(['number', 'string', 'date', 'enum']),
  role: z.enum(['input', 'derived']),
  sourceColumnId: z.string().optional(),
  formula: z.string().max(MAX_FORMULA_LENGTH).optional(),
  unit: z.string().max(32).optional(),
  missing: z.boolean().optional(),
});

const collectionNodeSchema = nodeBaseSchema.extend({
  kind: z.literal('collection'),
  datasetId: z.string(),
  fields: z.array(fieldDefSchema).max(512),
  dataRevision: z.number().int().nonnegative(),
  dataMissing: z.boolean().optional(),
});

const nodeSchema = z.discriminatedUnion('kind', [
  variableNodeSchema,
  groupNodeSchema,
  collectionNodeSchema,
]);

const datasetColumnSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(['number', 'string', 'date', 'enum']),
  sourceIndex: z.number().int().nonnegative(),
});

const datasetMetaSchema = z.object({
  id: z.string(),
  name: z.string(),
  format: z.enum(['csv', 'jsonl', 'xlsx', 'manual']),
  storage: z.enum(['blob', 'manual']),
  blobKey: z.string().optional(),
  encoding: z.string().optional(),
  delimiter: z.string().optional(),
  hasHeader: z.boolean().optional(),
  sheet: z.string().optional(),
  timeZone: z.string().optional(),
  dateFormat: z.string().optional(),
  parserVersion: z.string(),
  dataUnavailable: z.boolean().optional(),
  rawBytesHash: z.string(),
  parseParamsHash: z.string(),
  contentHash: z.string(),
  outputDigest: z.string(),
  columns: z.array(datasetColumnSchema).max(4096),
  rowCount: z.number().int().nonnegative(),
  datasetHash: z.string(),
  createdAt: z.number().int().nonnegative(),
});

const filterSchema = z.object({
  fieldId: z.string(),
  op: z.enum([
    'eq',
    'neq',
    'gt',
    'gte',
    'lt',
    'lte',
    'in',
    'contains',
    'isNull',
    'notNull',
  ]),
  value: z
    .union([z.string(), z.number(), z.boolean(), z.null(), z.array(z.union([z.string(), z.number()]))])
    .optional(),
});

const metricSchema = z.object({
  id: z.string(),
  op: z.enum(['count', 'sum', 'avg', 'min', 'max', 'median', 'p90', 'p95']),
  fieldId: z.string().optional(),
  alias: z.string(),
});

const chartSchema = z.object({
  type: z.enum(['line', 'bar', 'scatter', 'histogram']),
  xFieldId: z.string().optional(),
  yMetricIds: z.array(z.string()).optional(),
  seriesFieldId: z.string().optional(),
});

const analysisViewSchema = z.object({
  id: z.string(),
  name: z.string(),
  datasetId: z.string(),
  filters: z.array(filterSchema),
  groupBy: z.array(z.string()),
  metrics: z.array(metricSchema),
  chart: chartSchema.optional(),
  timeBucket: z
    .object({
      fieldId: z.string(),
      unit: z.enum(['minute', 'hour', 'day', 'month']),
    })
    .optional(),
  schemaHash: z.string(),
  status: z.enum(['active', 'broken']),
  brokenReason: z.string().optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

const comparisonBase = {
  id: z.string(),
  name: z.string(),
  datasetId: z.string(),
  configHash: z.string(),
  status: z.enum(['active', 'broken']),
  brokenReason: z.string().optional(),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
};

const toleranceSchema = z.object({
  abs: z.number().nonnegative().optional(),
  rel: z.number().nonnegative().optional(),
});

const comparisonSchema = z.discriminatedUnion('mode', [
  z.object({
    ...comparisonBase,
    mode: z.literal('curve-vs-aggregate'),
    analysisViewId: z.string(),
    modelNodeId: z.string(),
    keyFieldId: z.string(),
    metricId: z.string(),
    tolerance: toleranceSchema.optional(),
  }),
  z.object({
    ...comparisonBase,
    mode: z.literal('column-to-input'),
    mapping: z.record(z.string(), z.string()),
    truthColumnId: z.string(),
    tolerance: toleranceSchema.optional(),
  }),
  z.object({
    ...comparisonBase,
    mode: z.literal('collection-vs-log'),
    collectionNodeId: z.string(),
    collectionFieldId: z.string(),
    truthColumnId: z.string(),
    tolerance: toleranceSchema.optional(),
  }),
]);

const relationSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  kind: z.literal('influence'),
  label: z.string().optional(),
});

const bundleSchema = z.object({
  id: z.string(),
  name: z.string().min(1).max(128),
  memberIds: z.array(z.string()),
  summary: z.object({
    mode: z.enum(['none', 'member', 'sum', 'product', 'avg', 'min', 'max']),
    memberId: z.string().optional(),
  }),
  color: z.string().optional(),
});

export const projectSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  nodes: z
    .record(z.string(), nodeSchema)
    .refine(
      (value) => Object.keys(value).length <= MAX_NODES,
      { message: `节点数量超过上限 ${MAX_NODES}` },
    ),
  datasets: z.array(datasetMetaSchema),
  views: z.array(analysisViewSchema),
  comparisons: z.array(comparisonSchema),
  tombstones: z.array(
    z.object({
      nodeId: z.string(),
      name: z.string(),
      deletedAt: z.number().int().nonnegative(),
    }),
  ),
  scenarios: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        overrides: z.record(z.string(), z.number()),
      }),
    )
    .optional(),
  relations: z.array(relationSchema).max(MAX_RELATIONS),
  bundles: z.array(bundleSchema).max(MAX_BUNDLES),
  createdAt: z.number().int().nonnegative(),
  updatedAt: z.number().int().nonnegative(),
});

export function parseProject(input: unknown): Project {
  const result = projectSchema.safeParse(input);
  if (!result.success) {
    const first = result.error.issues[0];
    const path = first?.path.join('.') ?? '(root)';
    throw new Error(`项目格式无效：${path} ${first?.message ?? '未知错误'}`);
  }
  return result.data as Project;
}
