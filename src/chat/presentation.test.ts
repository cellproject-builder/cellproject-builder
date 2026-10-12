import { beforeEach, expect, it } from 'vitest';
import { useChatPresentation } from './presentation';

beforeEach(() => useChatPresentation.setState({ expanded: false, canvasLauncher: null, canvasPanel: 'center' }));

it('couples completed docking and undocking to the next canvas conversation placement', () => {
  useChatPresentation.getState().setCanvasLauncher({ y: .45 });
  expect(useChatPresentation.getState()).toMatchObject({ canvasLauncher: { y: .45 }, canvasPanel: 'right' });
  useChatPresentation.getState().setCanvasLauncher(null);
  expect(useChatPresentation.getState()).toMatchObject({ canvasLauncher: null, canvasPanel: 'center' });
});

it('lets the open panel move independently without discarding launcher or expanded preferences', () => {
  useChatPresentation.getState().setCanvasLauncher({ y: .6 });
  useChatPresentation.getState().setExpanded(true);
  useChatPresentation.getState().setCanvasPanel('center');
  expect(useChatPresentation.getState()).toMatchObject({ expanded: true, canvasLauncher: { y: .6 }, canvasPanel: 'center' });
});
