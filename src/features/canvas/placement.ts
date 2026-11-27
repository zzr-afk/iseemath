import type { Project, Vec2 } from '@/core/model/types';

/** First name of the form `baseN` (N starting at 1) that is not taken. */
export function uniqueNodeName(project: Project, base: string): string {
  const names = new Set(
    Object.values(project.nodes).map((node) => node.name.toLocaleLowerCase()),
  );
  let index = 1;
  while (names.has(`${base}${index}`.toLocaleLowerCase())) index += 1;
  return `${base}${index}`;
}

/** Simple staggered default position for a new card. */
export function nextNodePosition(project: Project): Vec2 {
  const index = Object.keys(project.nodes).length;
  return { x: 80 + (index % 4) * 280, y: 90 + Math.floor(index / 4) * 150 };
}

