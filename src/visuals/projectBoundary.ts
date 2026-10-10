import type { Project } from '@/types';
import { clearMissingVisualNodeLinks, normalizeVisualWorkspace } from './normalize';

/** Schema validation clones objects; property order alone is not a data change. */
function sameStructure(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length
      && left.every((value, index) => sameStructure(value, right[index]));
  }
  const keys = Object.keys(left), otherKeys = Object.keys(right);
  return keys.length === otherKeys.length && keys.every(key => Object.hasOwn(right, key)
    && sameStructure((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}

/** Persistence recovery isolates visual corruption; it never discards the concept plan. */
export function normalizeStoredProjectVisuals(project: Project | null | undefined): Project | null {
  if (!project) return null;
  if (project.visuals === undefined) return project;
  try {
    const visuals = clearMissingVisualNodeLinks(normalizeVisualWorkspace(project.visuals), project.nodes);
    // Idle remounts/HMR must not turn a validated in-memory snapshot into a
    // persistence write that can replace another tab's newer project.
    return sameStructure(project.visuals, visuals) ? project : { ...project, visuals };
  }
  catch {
    const { visuals: _invalid, ...conceptPlan } = project;
    return conceptPlan;
  }
}
