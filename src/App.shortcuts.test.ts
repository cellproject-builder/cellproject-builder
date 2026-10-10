import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { handleAppShortcut } from './App';
import { useGraphStore } from './store';
import { useWorkspaceStore } from './workspace/store';
import { fallbackClassifyAIError } from './hooks/useAIAction';
import type { AIPlan } from './types';

const plan: AIPlan = {
  id: 'p1',
  title: 'Plano',
  pitch: 'pitch',
  approach: 'approach',
  strategy: 'reaproveitar',
  archetype: 'construir',
  rank: 1,
  rankReason: 'r',
  tree: { categorias: [] },
};

const key = (k: string, target: EventTarget | null = document.body, mods = {}) =>
  handleAppShortcut({ key: k, metaKey: false, ctrlKey: false, altKey: false, target, ...mods });

describe('global shortcuts', () => {
  beforeEach(() => {
    useGraphStore.getState().resetProject();
    useGraphStore.getState().createProjectFromPlan('obj', 'Atalhos', plan);
    useWorkspaceStore.getState().navigate('planner');
  });
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('g / t switch views from a neutral target', () => {
    key('g');
    expect(useGraphStore.getState().viewMode).toBe('graph');
    key('t');
    expect(useGraphStore.getState().viewMode).toBe('tutor');
  });

  it('does not change the hidden planner while the user is managing a project', () => {
    useWorkspaceStore.getState().navigate('kanban');
    key('g');
    expect(useGraphStore.getState().viewMode).toBe('tutor');
  });

  it('ignores select, contentEditable, inputs and modifier combos', () => {
    const select = document.createElement('select');
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    // jsdom não implementa isContentEditable — espelha o comportamento do browser.
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    const input = document.createElement('input');
    for (const target of [select, editable, input]) {
      key('g', target);
      expect(useGraphStore.getState().viewMode).toBe('tutor');
    }
    key('g', document.body, { ctrlKey: true });
    key('g', document.body, { metaKey: true });
    key('g', document.body, { altKey: true });
    expect(useGraphStore.getState().viewMode).toBe('tutor');
  });

  it('1-5 only change the lens in the graph view', () => {
    key('3');
    expect(useGraphStore.getState().lens).toBe('structure');
    key('g');
    key('3');
    expect(useGraphStore.getState().lens).toBe('risk');
  });

  it('does nothing while a modal dialog is open', () => {
    const dialog = document.createElement('div');
    dialog.setAttribute('aria-modal', 'true');
    document.body.appendChild(dialog);
    key('g');
    expect(useGraphStore.getState().viewMode).toBe('tutor');
  });
});

describe('fallbackClassifyAIError', () => {
  it('maps common provider failures to actionable kinds', () => {
    expect(fallbackClassifyAIError(Object.assign(new Error('Unauthorized'), { statusCode: 401 })).kind).toBe('auth');
    expect(fallbackClassifyAIError(Object.assign(new Error('x'), { statusCode: 402 })).kind).toBe('credits');
    expect(fallbackClassifyAIError(Object.assign(new Error('x'), { statusCode: 429 })).kind).toBe('rate');
    expect(fallbackClassifyAIError(new TypeError('Failed to fetch')).kind).toBe('network');
    expect(fallbackClassifyAIError(new Error('No object generated: response did not match schema')).kind).toBe('schema');
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    expect(fallbackClassifyAIError(abort).kind).toBe('aborted');
    const unknown = fallbackClassifyAIError('boom');
    expect(unknown.kind).toBe('unknown');
    expect(unknown.title).toBeTruthy();
    expect(unknown.detail).toBe('boom');
  });
});
