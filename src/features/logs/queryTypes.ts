import { nanoid } from 'nanoid';
import type { Filter, Metric } from '@/core/model/types';
import type { TimeBucketUnit } from '@/core/logs/aggregate';

export interface QueryConfig {
  filters: Filter[];
  groupBy: string[];
  metrics: Metric[];
  timeBucketUnit: 'raw' | TimeBucketUnit;
  chartType: 'line' | 'bar';
}

export function createDefaultQuery(): QueryConfig {
  return {
    filters: [],
    groupBy: [],
    metrics: [{ id: nanoid(), op: 'count', alias: '行数' }],
    timeBucketUnit: 'raw',
    chartType: 'line',
  };
}
