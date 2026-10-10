import type { Project } from '@/types';
import type { MentionTarget, VisualPromptInput } from './types';

type Source = { target: MentionTarget; text: string };
/** Traverse relationships, never node fields containing hidden assessment data. */
export function advancedContextScope(project: Project, input: VisualPromptInput, sources: Source[]) {
  const explicit = input.mentions.filter(item => item.kind === 'node').map(item => item.id);
  const linked = input.mentions.filter(item => item.kind === 'image').flatMap(item => {
    const nodeId = project.visuals?.artifacts.find(artifact => artifact.id === item.id)?.linkedNodeId;
    return nodeId ? [nodeId] : [];
  });
  const roots = [...new Set([...explicit, ...linked])].filter(id => Object.hasOwn(project.nodes, id));
  const related = new Set(roots), descendants = new Set(roots);
  const children = new Map<string, string[]>();
  for (const node of Object.values(project.nodes)) if (node.parentId) children.set(node.parentId, [...(children.get(node.parentId) ?? []), node.id]);
  const queue = [...roots];
  for (let index = 0; index < queue.length; index++) for (const child of children.get(queue[index]) ?? []) {
    if (!descendants.has(child)) { descendants.add(child); related.add(child); queue.push(child); }
  }
  // Ancestors provide purpose. Do not expand their other children into this branch.
  for (const root of roots) {
    let parent = project.nodes[root]?.parentId; const seen = new Set<string>();
    while (parent && !seen.has(parent) && Object.hasOwn(project.nodes, parent)) {
      seen.add(parent); related.add(parent); parent = project.nodes[parent].parentId;
    }
  }
  const incoming = new Map<string, string[]>();
  for (const edge of Object.values(project.edges)) incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]);
  const dependencies = [...descendants];
  for (let index = 0; index < dependencies.length; index++) for (const id of incoming.get(dependencies[index]) ?? []) {
    if (!related.has(id) && Object.hasOwn(project.nodes, id)) { related.add(id); dependencies.push(id); }
  }
  const nodes = sources.filter(source => source.target.kind === 'node' && related.has(source.target.id));
  nodes.sort((a, b) => Number(roots.includes(b.target.id)) - Number(roots.includes(a.target.id)) || a.target.id.localeCompare(b.target.id));
  const imageIds = new Set(project.visuals?.artifacts.filter(artifact => artifact.kind === 'image' && artifact.linkedNodeId && related.has(artifact.linkedNodeId)).map(artifact => artifact.id) ?? []);
  for (const target of input.mentions) if (target.kind === 'image') imageIds.add(target.id);
  const images = sources.filter(source => source.target.kind === 'image' && imageIds.has(source.target.id));
  const visibleNodes = nodes.slice(0, 120), visibleImages = images.slice(0, 24);
  // Names and types are sufficient for routing; detailed bodies are fetched after selection.
  const outline = { roots, nodes: visibleNodes.map(source => ({ id: source.target.id, name: source.target.label.slice(0, 120), kind: source.target.detail,
      parentId: project.nodes[source.target.id].parentId, relation: roots.includes(source.target.id) ? 'selected' : descendants.has(source.target.id) ? 'descendant' : 'ancestor-or-prerequisite' })),
      images: visibleImages.map(source => ({ id: source.target.id, label: source.target.label.slice(0, 120), nodeId: project.visuals?.artifacts.find(artifact => artifact.id === source.target.id)?.linkedNodeId ?? null })),
      omitted: Math.max(0, nodes.length - visibleNodes.length) + Math.max(0, images.length - visibleImages.length) };
  while (new TextEncoder().encode(JSON.stringify(outline)).byteLength > 16000 && (outline.images.length || outline.nodes.length > roots.length)) {
    if (outline.images.length) outline.images.pop(); else outline.nodes.pop(); outline.omitted++;
  }
  return {
    roots, nodeIds: outline.nodes.map(source => source.id), imageIds: outline.images.map(source => source.id), outline,
    fingerprintData: [nodes.map(source => [source.target.id, source.target.fingerprint]), images.map(source => [source.target.id, source.target.fingerprint, project.visuals?.artifacts.find(artifact => artifact.id === source.target.id)?.linkedNodeId ?? null]),
      Object.values(project.edges).filter(edge => related.has(edge.target)).map(edge => [edge.source, edge.target, edge.kind])],
  };
}
