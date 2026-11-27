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
