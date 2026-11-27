export interface CycleAnalysis {
  cycles: string[][];
  inCycle: Set<string>;
}

/** Tarjan strongly-connected components; only SCCs with >1 node or self-loops are cycles. */
export function findCycles(graph: Map<string, string[]>): CycleAnalysis {
  let index = 0;
  const indices = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const onStack = new Set<string>();
  const cycles: string[][] = [];
  const inCycle = new Set<string>();

  function strongConnect(node: string): void {
    indices.set(node, index);
    lowLinks.set(node, index);
    index += 1;
    stack.push(node);
    onStack.add(node);

    for (const next of graph.get(node) ?? []) {
      if (!indices.has(next)) {
        strongConnect(next);
        lowLinks.set(node, Math.min(lowLinks.get(node)!, lowLinks.get(next)!));
      } else if (onStack.has(next)) {
        lowLinks.set(node, Math.min(lowLinks.get(node)!, indices.get(next)!));
      }
    }

    if (lowLinks.get(node) === indices.get(node)) {
      const component: string[] = [];
      for (;;) {
        const member = stack.pop()!;
        onStack.delete(member);
        component.push(member);
        if (member === node) break;
      }
      const selfLoop = component.length === 1 && (graph.get(component[0]!) ?? []).includes(component[0]!);
      if (component.length > 1 || selfLoop) {
        cycles.push(component);
        for (const member of component) inCycle.add(member);
      }
    }
  }

  for (const node of graph.keys()) {
    if (!indices.has(node)) strongConnect(node);
  }

  return { cycles, inCycle };
}

/** Kahn topological sort; nodes in cycles are excluded. */
export function topologicalOrder(
  nodes: string[],
  dependencies: Map<string, string[]>,
): { order: string[]; cyclic: string[] } {
  const graph = new Map<string, string[]>();
  const inDegree = new Map<string, number>();
  for (const node of nodes) {
    graph.set(node, []);
    inDegree.set(node, 0);
  }
  for (const node of nodes) {
    for (const dependency of dependencies.get(node) ?? []) {
      if (!graph.has(dependency)) continue;
      graph.get(dependency)!.push(node);
      inDegree.set(node, inDegree.get(node)! + 1);
    }
  }

  const queue = nodes.filter((node) => inDegree.get(node) === 0);
  const order: string[] = [];
  while (queue.length > 0) {
    const node = queue.shift()!;
    order.push(node);
    for (const next of graph.get(node) ?? []) {
      const degree = inDegree.get(next)! - 1;
      inDegree.set(next, degree);
      if (degree === 0) queue.push(next);
    }
  }

  const ordered = new Set(order);
  return { order, cyclic: nodes.filter((node) => !ordered.has(node)) };
}
