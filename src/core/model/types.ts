export type NodeId = string;

export type NodeKind = 'variable' | 'group' | 'collection';
export type VariableKind = 'constant' | 'formula' | 'curve' | 'table';
export type VariableRole = 'input' | 'intermediate' | 'output';

export interface Vec2 {
  x: number;
  y: number;
}

export interface NodeBase {
  id: NodeId;
  kind: NodeKind;
  name: string;
  label: string;
  description?: string;
  tags: string[];
  parentId: NodeId | null;
  position: Vec2;
  color?: string;
  createdAt: number;
  updatedAt: number;
}

export type CurveInterpolation = 'linear' | 'step' | 'monotone';
export type CurveExtrapolation = 'clamp' | 'extend' | 'error';

export interface CurveData {
  points: { x: number; y: number }[];
  interpolation: CurveInterpolation;
  extrapolation: CurveExtrapolation;
}

export interface TableData {
  keyColumn: string;
  columns: { id: string; name: string; type: 'number' | 'string' }[];
  rows: (number | string)[][];
  lookup: 'exact' | 'linear';
}

export interface VariableNode extends NodeBase {
  kind: 'variable';
  variableKind: VariableKind;
  role: VariableRole;
  unit?: string;
  precision?: number;
  value?: number;
  formula?: string;
  curve?: CurveData;
  table?: TableData;
}

export interface GroupNode extends NodeBase {
  kind: 'group';
}

export type FieldType = 'number' | 'string' | 'date' | 'enum';

export interface FieldDef {
  id: string;
  name: string;
  label: string;
  type: FieldType;
  role: 'input' | 'derived';
  sourceColumnId?: string;
  formula?: string;
  unit?: string;
  missing?: boolean;
}

export interface CollectionNode extends NodeBase {
  kind: 'collection';
  datasetId: string;
  fields: FieldDef[];
  dataRevision: number;
  dataMissing?: boolean;
}

export type AnyNode = VariableNode | GroupNode | CollectionNode;

export interface DatasetColumn {
  id: string;
  name: string;
  type: FieldType;
  sourceIndex: number;
}

export interface DatasetMeta {
  id: string;
  name: string;
  format: 'csv' | 'jsonl' | 'xlsx' | 'manual';
  storage: 'blob' | 'manual';
  blobKey?: string;
  encoding?: string;
  delimiter?: string;
  /** CSV header row present; JSONL always ignores this. */
  hasHeader?: boolean;
  sheet?: string;
  timeZone?: string;
  dateFormat?: string;
  parserVersion: string;
  dataUnavailable?: boolean;
  rawBytesHash: string;
  parseParamsHash: string;
  contentHash: string;
  outputDigest: string;
  columns: DatasetColumn[];
  rowCount: number;
  datasetHash: string;
  createdAt: number;
}

export type FilterOp =
  | 'eq'
  | 'neq'
  | 'gt'
  | 'gte'
  | 'lt'
  | 'lte'
  | 'in'
  | 'contains'
  | 'isNull'
  | 'notNull';

export interface Filter {
  fieldId: string;
  op: FilterOp;
  value?: string | number | boolean | null | (string | number)[];
}

export type MetricOp = 'count' | 'sum' | 'avg' | 'min' | 'max' | 'median' | 'p90' | 'p95';

export interface Metric {
  id: string;
  op: MetricOp;
  fieldId?: string;
  alias: string;
}

export interface ChartSpec {
  type: 'line' | 'bar' | 'scatter' | 'histogram';
  xFieldId?: string;
  yMetricIds?: string[];
  seriesFieldId?: string;
}

export interface AnalysisView {
  id: string;
  name: string;
  datasetId: string;
  filters: Filter[];
  groupBy: string[];
  metrics: Metric[];
  chart?: ChartSpec;
  timeBucket?: { fieldId: string; unit: 'minute' | 'hour' | 'day' | 'month' };
  schemaHash: string;
  status: 'active' | 'broken';
  brokenReason?: string;
  createdAt: number;
  updatedAt: number;
}

export type ComparisonMode = 'curve-vs-aggregate' | 'column-to-input' | 'collection-vs-log';

export interface Tolerance {
  abs?: number;
  rel?: number;
}

export interface ComparisonBase {
  id: string;
  name: string;
  datasetId: string;
  configHash: string;
  status: 'active' | 'broken';
  brokenReason?: string;
  createdAt: number;
  updatedAt: number;
}

export type ComparisonConfig =
  | (ComparisonBase & {
      mode: 'curve-vs-aggregate';
      analysisViewId: string;
      modelNodeId: NodeId;
      keyFieldId: string;
      metricId: string;
      tolerance?: Tolerance;
    })
  | (ComparisonBase & {
      mode: 'column-to-input';
      mapping: Record<NodeId, string>;
      truthColumnId: string;
      tolerance?: Tolerance;
    })
  | (ComparisonBase & {
      mode: 'collection-vs-log';
      collectionNodeId: NodeId;
      collectionFieldId: string;
      truthColumnId: string;
      tolerance?: Tolerance;
    });

export interface ComparisonRunMeta {
  comparisonId: string;
  evalHash: string;
  datasetHash: string;
  configHash: string;
  ranAt: number;
  summary?: { rows: number; errors: number; mae?: number; rmse?: number; mape?: number };
}

export interface Tombstone {
  nodeId: NodeId;
  name: string;
  deletedAt: number;
}

export interface Scenario {
  id: string;
  name: string;
  overrides: Record<NodeId, number>;
}

export interface Relation {
  id: string;
  source: NodeId;
  target: NodeId;
  kind: 'influence';
  label?: string;
}

export type BundleSummaryMode = 'none' | 'member' | 'sum' | 'product' | 'avg' | 'min' | 'max';

export interface Bundle {
  id: string;
  name: string;
  memberIds: NodeId[];
  summary: {
    mode: BundleSummaryMode;
    memberId?: NodeId;
  };
  color?: string;
}

export interface Project {
  schemaVersion: 1;
  id: string;
  name: string;
  description?: string;
  nodes: Record<NodeId, AnyNode>;
  datasets: DatasetMeta[];
  views: AnalysisView[];
  comparisons: ComparisonConfig[];
  tombstones: Tombstone[];
  scenarios?: Scenario[];
  relations: Relation[];
  bundles: Bundle[];
  createdAt: number;
  updatedAt: number;
}

export interface ProjectViewState {
  schemaVersion: 1;
  bundleCollapsed: Record<string, boolean>;
  groupCollapsed: Record<NodeId, boolean>;
  nodeSizes?: Record<NodeId, { width: number; height: number }>;
  viewport?: { x: number; y: number; zoom: number };
}

export function isVariableNode(node: AnyNode): node is VariableNode {
  return node.kind === 'variable';
}

export function isGroupNode(node: AnyNode): node is GroupNode {
  return node.kind === 'group';
}

export function isCollectionNode(node: AnyNode): node is CollectionNode {
  return node.kind === 'collection';
}
