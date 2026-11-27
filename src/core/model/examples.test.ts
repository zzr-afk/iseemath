import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { evaluateProject } from '@/core/eval/projectEval';
import { analyzeCollectionFields } from './collection';
import { validateProject } from './invariants';
import { parseProject } from './projectSchema';
import type { CollectionNode } from './types';

function loadExample(file: string): unknown {
  const path = resolve(process.cwd(), 'docs', 'examples', file);
  return JSON.parse(readFileSync(path, 'utf8')) as unknown;
}

describe('docs/examples', () => {
  it('formula example passes schema and invariants, and evaluates', () => {
    const envelope = loadExample('formula.project.json') as { project?: unknown };
    const project = parseProject(envelope.project);
    expect(validateProject(project)).toEqual([]);

    const result = evaluateProject(project);
    expect(result.errors).toEqual({});
    expect(result.values.var_damage).toBeCloseTo(170, 10);
  });

  it('bishop 6-minute graph example evaluates to the report totals without Commandment', () => {
    const envelope = loadExample('bishop-6min-graph.project.json') as { project?: unknown };
    const project = parseProject(envelope.project);
    expect(validateProject(project)).toEqual([]);

    const result = evaluateProject(project);
    expect(result.errors).toEqual({});
    expect(result.values.f_t1).toBeCloseTo(130.526073, 5);
    expect(result.values.f_t7).toBeCloseTo(50.401336, 5);
    expect(result.values.f_ar_line_t7).toBeCloseTo(141309217.95, 0);
    expect(result.values.f_aj_line_t7).toBeCloseTo(342096044.6, 0);
    expect(result.values.f_total).toBeCloseTo(5197610161788.648, 2);
    expect(result.values.f_dps).toBeCloseTo(14437806004.9685, 3);
    expect(result.values.f_share_ar_total).toBeCloseTo(0.715577, 5);
  });

  it('collection example passes schema and invariants, with resolvable fields', () => {
    const envelope = loadExample('collection.project.json') as { project?: unknown };
    const project = parseProject(envelope.project);
    expect(validateProject(project)).toEqual([]);

    const collection = project.nodes.col_monster as CollectionNode;
    const dataset = project.datasets[0];
    expect(dataset?.id).toBe(collection.datasetId);
    for (const field of collection.fields) {
      if (field.role !== 'input') continue;
      expect(dataset?.columns.some((column) => column.id === field.sourceColumnId)).toBe(true);
    }

    const analysis = analyzeCollectionFields(collection);
    expect(analysis.fieldErrors.size).toBe(0);
    expect(analysis.unresolved.get('f_power')).toEqual(['伤害倍率']);
    expect(analysis.dependencies.get('f_power')).toEqual(
      expect.arrayContaining(['f_hp', 'f_atk', 'f_def']),
    );
  });
});
