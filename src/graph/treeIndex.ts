import type { ConceptNodeData, Project } from '@/types';

/** Stable sibling order for domain traversal; independent of UI and stores. */
export const childrenByParent = (project: Project): Map<string, ConceptNodeData[]> => {
  const map = new Map<string, ConceptNodeData[]>();
  for (const n of Object.values(project.nodes)) {
    if (!n.parentId) continue;
    const arr = map.get(n.parentId);
    if (arr) arr.push(n);
    else map.set(n.parentId, [n]);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name));
  }
  return map;
};
