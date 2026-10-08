import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { KnowledgeRepo } from './KnowledgeRepo';
import { useKBStore, type IngestProgress } from '@/kb/store';
import { useLocaleStore } from '@/i18n';

// React 18: act() fora do testing-library precisa desta flag.
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;
const onClose = vi.fn();
const addFromPdf = vi.fn();

function render() {
  act(() => {
    root.render(<KnowledgeRepo open onClose={onClose} />);
  });
}

// jsdom não implementa DataTransfer: montamos um evento com os campos que o
// componente lê (types/files).
function dropEvent(files: File[]): Event {
  const ev = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(ev, 'dataTransfer', {
    value: { types: ['Files'], files, dropEffect: 'none' },
  });
  return ev;
}

const pdf = () => new File(['%PDF'], 'manual.pdf', { type: 'application/pdf' });

beforeEach(() => {
  useLocaleStore.getState().setLocale('pt-BR');
  onClose.mockReset();
  addFromPdf.mockReset();
  useKBStore.setState({ docs: {}, usage: {}, pickCache: {}, lastContext: null, addFromPdf });
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

const dropzone = () =>
  document.body.querySelector<HTMLElement>('[role="dialog"] [role="button"][aria-label]')!;

describe('KnowledgeRepo', () => {
  it('Esc fecha o modal', () => {
    render();
    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('soltar um PDF na caixa adiciona sem o navegador abrir o arquivo', async () => {
    addFromPdf.mockResolvedValue('id1');
    render();
    const ev = dropEvent([pdf()]);
    await act(async () => {
      dropzone().dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(true);
    expect(addFromPdf).toHaveBeenCalledTimes(1);
    expect((addFromPdf.mock.calls[0][0] as File).name).toBe('manual.pdf');
  });

  it('soltar fora da caixa (modal aberto) também é tratado', async () => {
    addFromPdf.mockResolvedValue('id1');
    render();
    const ev = dropEvent([pdf()]);
    await act(async () => {
      window.dispatchEvent(ev);
    });
    expect(ev.defaultPrevented).toBe(true);
    expect(addFromPdf).toHaveBeenCalledTimes(1);
  });

  it('erro de resumo fica visível até ser dispensado e oferece tentar de novo', async () => {
    vi.useFakeTimers();
    addFromPdf.mockImplementation(async (file: File, onProgress: (p: IngestProgress) => void) => {
      onProgress({
        phase: 'error',
        filename: file.name,
        errorKind: 'summary',
        errorInfo: { kind: 'network', title: 'Sem conexão', hint: 'Confira sua internet.' },
      });
      return null;
    });
    render();
    await act(async () => {
      dropzone().dispatchEvent(dropEvent([pdf()]));
    });
    await act(async () => {
      vi.advanceTimersByTime(30_000);
    });
    const alert = document.body.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain('manual.pdf');
    expect(alert?.textContent).toContain('Sem conexão');

    const buttons = [...alert!.querySelectorAll('button')];
    const retry = buttons.find((b) => b.textContent?.includes('Tentar de novo'))!;
    expect(retry).toBeDefined();
    await act(async () => {
      retry.click();
    });
    expect(addFromPdf).toHaveBeenCalledTimes(2);

    const dismiss = [...document.body.querySelectorAll<HTMLButtonElement>('[role="alert"] button')].find((b) =>
      b.textContent?.includes('Dispensar'),
    )!;
    await act(async () => {
      dismiss.click();
    });
    expect(document.body.querySelector('[role="alert"]')).toBeNull();
  });

  it('PDF repetido avisa que já estava na base', async () => {
    addFromPdf.mockImplementation(async (file: File, onProgress: (p: IngestProgress) => void) => {
      onProgress({ phase: 'done', filename: file.name, duplicate: true, docId: 'x' });
      return 'x';
    });
    render();
    await act(async () => {
      dropzone().dispatchEvent(dropEvent([pdf()]));
    });
    expect(document.body.textContent).toContain('já estava na sua base');
  });
});
