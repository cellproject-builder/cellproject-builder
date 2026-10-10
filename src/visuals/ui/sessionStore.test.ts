import { beforeEach, describe, expect, it } from 'vitest';
import type { VisualPromptInput } from '../types';
import { useVisualSessionStore } from './sessionStore';

const input = (text = ''): VisualPromptInput => ({ text, mentions: [], attachments: [] });
const drafts = () => ({ search: input('ESP32'), model: input('Servo MG90S') });
const state = () => useVisualSessionStore.getState();

beforeEach(() => state().reset());

describe('visual tool sessions', () => {
  it('initializes each requested tool once and resets only when the project changes', () => {
    state().initialize('project-a', drafts(), ['search', 'model', 'search', 'unknown']);
    expect(state().windows).toHaveLength(2);
    const search = Object.values(state().tabs).find(tab => tab.kind === 'search')!;
    expect(search.draft.text).toBe('ESP32');
    state().updateDraft(search.id, input('Arduino Uno'));
    state().initialize('project-a', drafts(), ['search', 'model']);
    expect(state().windows).toHaveLength(2);
    expect(state().tabs[search.id].draft.text).toBe('Arduino Uno');
    state().initialize('project-b', drafts(), ['model']);
    expect(state().projectId).toBe('project-b');
    expect(state().tabs[search.id]).toBeUndefined();
    expect(Object.values(state().tabs).map(tab => tab.kind)).toEqual(['model']);
  });

  it('keeps three drafts isolated and starts further tabs blank without an artificial cap', () => {
    state().initialize('project-a', drafts(), ['model']);
    const first = state().windows[0].activeTabId;
    const second = state().newTab('model');
    const third = state().newTab('model', { input: input('Robotic arm') });
    state().updateDraft(second, input('Arduino Uno'));
    const fourth = state().newTab('model');
    expect(state().windows).toHaveLength(1);
    expect(state().windows[0].tabIds).toEqual([first, second, third, fourth]);
    expect(state().tabs[first].draft.text).toBe('Servo MG90S');
    expect(state().tabs[second].draft.text).toBe('Arduino Uno');
    expect(state().tabs[third].draft.text).toBe('Robotic arm');
    expect(state().tabs[fourth].draft).toEqual(input());
  });

  it('detaches, reorders and reunites tabs without changing draft or activity identity', () => {
    state().initialize('project-a', drafts(), ['model']);
    const originalWindow = state().windows[0].id;
    const first = state().windows[0].activeTabId;
    const second = state().newTab('model', { input: input('Detailed assembly') });
    const third = state().newTab('model');
    state().setActivity(second, { state: 'running', label: 'Building module 2' });
    const tab = state().tabs[second];
    state().move(third, originalWindow, first);
    expect(state().windows[0].tabIds).toEqual([third, first, second]);
    state().detach(second, { x: 120, y: 75 });
    const detached = state().windows.find(window => window.id !== originalWindow)!;
    expect(detached.tabIds).toEqual([second]);
    expect(detached.frame).toMatchObject({ x: 120, y: 75 });
    expect(state().tabs[second]).toBe(tab);
    state().move(second, originalWindow, first);
    expect(state().windows).toHaveLength(1);
    expect(state().windows[0].tabIds).toEqual([third, second, first]);
    expect(state().windows[0].activeTabId).toBe(second);
    expect(state().tabs[second]).toBe(tab);
    expect(state().tabs[second].draft).toBe(tab.draft);
    expect(state().tabs[second].activity).toBe(tab.activity);
  });

  it('keeps running tabs mounted when closing or hiding and restores their window', () => {
    state().initialize('project-a', drafts(), ['model']);
    const tabId = state().windows[0].activeTabId;
    const windowId = state().windows[0].id;
    state().setActivity(tabId, { state: 'running', label: 'Generating' });
    const tab = state().tabs[tabId];
    state().closeTab(tabId);
    expect(state().tabs[tabId]).toBe(tab);
    expect(state().windows[0]).toMatchObject({ minimized: true, hidden: false });
    state().restoreWindow(windowId);
    expect(state().windows[0]).toMatchObject({ minimized: false, hidden: false });
    state().hideWindow(windowId);
    expect(state().windows[0]).toMatchObject({ minimized: true, hidden: false });
    state().setActivity(tabId, { state: 'ready', label: 'Ready' });
    state().hideWindow(windowId);
    expect(state().windows[0]).toMatchObject({ minimized: false, hidden: true });
    expect(state().tabs[tabId].activity.state).toBe('ready');
    state().activate(tabId);
    expect(state().windows[0]).toMatchObject({ minimized: false, hidden: false, activeTabId: tabId });
  });

  it('selects an adjacent tab after closing idle content and removes empty windows', () => {
    state().initialize('project-a', drafts(), ['search']);
    const first = state().windows[0].activeTabId;
    const second = state().newTab('search');
    const third = state().newTab('search');
    state().activate(second);
    state().closeTab(second);
    expect(state().tabs[second]).toBeUndefined();
    expect(state().windows[0]).toMatchObject({ tabIds: [first, third], activeTabId: third });
    state().closeTab(third);
    expect(state().windows[0].activeTabId).toBe(first);
    state().closeTab(first);
    expect(state().windows).toEqual([]);
    expect(state().tabs).toEqual({});
  });

  it('preserves the selected tab when closing an inactive neighbor and isolates tool kinds', () => {
    state().initialize('project-a', drafts(), ['search', 'model']);
    const searchWindow = state().windows.find(window => window.kind === 'search')!;
    const modelWindow = state().windows.find(window => window.kind === 'model')!;
    const second = state().newTab('search', { windowId: searchWindow.id });
    state().closeTab(searchWindow.activeTabId);
    expect(state().windows.find(window => window.id === searchWindow.id)!.activeTabId).toBe(second);
    const before = state().windows;
    state().move(second, modelWindow.id);
    expect(state().windows).toBe(before);
    expect(state().windows.find(window => window.id === searchWindow.id)!.tabIds).toEqual([second]);
  });

  it('stores frame, focus and inspector per session without sharing caller draft arrays', () => {
    const source = input('Reference board');
    source.mentions.push({ id: 'image-1', kind: 'image', label: 'ESP32', detail: '', fingerprint: '1' });
    const tabId = state().newTab('model', { input: source, inspectedArtifactId: 'model-1' });
    const windowId = state().windows[0].id;
    source.mentions[0].label = 'Changed elsewhere';
    expect(state().tabs[tabId].draft.mentions[0].label).toBe('ESP32');
    expect(state().tabs[tabId].inspectedArtifactId).toBe('model-1');
    state().setInspector(tabId, null);
    expect(state().tabs[tabId].inspectedArtifactId).toBeNull();
    state().setFrame(windowId, { x: 10, y: 20, width: 500, height: 600 });
    const order = state().windows[0].order;
    state().focusWindow(windowId);
    expect(state().windows[0].frame).toEqual({ x: 10, y: 20, width: 500, height: 600 });
    expect(state().windows[0].order).toBeGreaterThan(order);
    state().minimizeWindow(windowId);
    expect(state().windows[0].minimized).toBe(true);
    expect(state().tabs[tabId].draft.text).toBe('Reference board');
  });

  it('starts controlled windows with tool dimensions and preserves size on detach', () => {
    state().initialize('project-a', drafts(), ['search', 'model']);
    const search = state().windows.find(window => window.kind === 'search')!;
    const model = state().windows.find(window => window.kind === 'model')!;
    expect(search.frame).toMatchObject({ width: 460, height: 520 });
    expect(model.frame).toMatchObject({ width: 420, height: 620 });
    state().detach(search.activeTabId, { x: 135, y: 80 });
    const detached = state().windows.find(window => window.activeTabId === search.activeTabId)!;
    expect(detached.frame).toEqual({ x: 135, y: 80, width: 460, height: 520 });
    expect(state().windows.some(window => window.id === search.id)).toBe(false);
  });

  it('does not notify subscribers for unchanged activity, inspector or frame callbacks', () => {
    state().initialize('project-a', drafts(), ['model']);
    const window = state().windows[0], tabId = window.activeTabId;
    state().setInspector(tabId, null);
    state().setFrame(window.id, { x: 10, y: 20, width: 420, height: 620 });
    let updates = 0;
    const unsubscribe = useVisualSessionStore.subscribe(() => { updates++; });
    state().setActivity(tabId, { state: 'idle', label: '' });
    state().setInspector(tabId, null);
    state().setFrame(window.id, { x: 10, y: 20, width: 420, height: 620 });
    expect(updates).toBe(0);
    state().setActivity(tabId, { state: 'running', label: 'Building' });
    expect(updates).toBe(1);
    unsubscribe();
  });
});
