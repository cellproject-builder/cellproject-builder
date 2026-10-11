import { useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { RowsIcon, ViewVerticalIcon } from '@/components/ui/SoftIcons';
import { useT } from '@/i18n';
import { PageHeaderContext } from './PageHeader';
import { Icon } from './ui';
import './ExecutionHeader.css';

export type ExecutionView = 'board' | 'list' | 'scrum';

/** Execution chrome stays outside the collection's scroll region. */
export function ExecutionHeader({ title, view, onViewChange, search, filters, filterActive = false, actions }: {
  title: string;
  view: ExecutionView;
  onViewChange: (view: ExecutionView) => void;
  search?: ReactNode;
  filters?: ReactNode;
  filterActive?: boolean;
  actions: ReactNode;
}) {
  const tr = useT().workspace;
  const shell = useContext(PageHeaderContext);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const options = useRef<HTMLDivElement>(null);
  const optionsButton = useRef<HTMLButtonElement>(null);
  const searchField = useRef<HTMLDivElement>(null);
  const closeOptions = () => {
    setOptionsOpen(false);
    // The compact menu hides its children when it closes. Keep keyboard focus
    // on its visible trigger; the desktop trigger is deliberately hidden.
    if (optionsButton.current?.getClientRects().length) optionsButton.current.focus();
  };
  const selectView = (next: ExecutionView) => {
    closeOptions();
    onViewChange(next);
    if ((view === 'scrum') !== (next === 'scrum')) requestAnimationFrame(() => {
      // Workspace remounts the main pane between task collections and Scrum.
      // Restore the keyboard position on the destination, after that commit.
      const destination = document.querySelector<HTMLElement>(`.ws-execution-header[data-view="${next}"]`);
      const trigger = destination?.querySelector<HTMLButtonElement>('.ws-execution-options-toggle');
      if (trigger?.getClientRects().length) trigger.focus();
      else destination?.querySelector<HTMLButtonElement>('[aria-pressed="true"]')?.focus();
    });
  };
  useEffect(() => {
    if (searchOpen) searchField.current?.querySelector('input')?.focus();
  }, [searchOpen]);
  useEffect(() => {
    if (!optionsOpen) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !options.current?.contains(event.target)) setOptionsOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [optionsOpen]);
  return <header className={`ws-execution-header${search ? ' has-search' : ''}${searchOpen ? ' is-search-open' : ''}`} data-view={view}>
    <div className="ws-execution-location">
      {shell?.navigation}
      <div className="ws-execution-identity">
        {shell?.breadcrumb && <div className="ws-breadcrumb">{shell.breadcrumb}</div>}
        <h1 title={title}>{title}</h1>
        {shell?.status}
      </div>
    </div>
    {search && <><div className="ws-execution-search" ref={searchField}>{search}</div><button className="ws-icon-button ws-execution-search-toggle" aria-label={tr.searchTasks} aria-expanded={searchOpen} onClick={() => setSearchOpen(!searchOpen)}><Icon name="search" /></button></>}
    <div className={`ws-execution-options${optionsOpen ? ' is-open' : ''}`} ref={options} onKeyDown={(event) => {
      if (event.key === 'Escape' && optionsOpen) { event.stopPropagation(); closeOptions(); }
    }}>
      <button ref={optionsButton} className="ws-icon-button ws-execution-options-toggle" aria-label={tr.executionOptions} aria-expanded={optionsOpen} onClick={() => setOptionsOpen(!optionsOpen)}>
        <Icon name="settings" />{filterActive && <span className="ws-execution-filter-dot" />}
      </button>
      <div className="ws-execution-options-content">
        <div className="ws-segmented ws-execution-view-switch" role="group" aria-label={tr.taskView}>
          <button aria-label={tr.boardView} title={tr.boardView} aria-pressed={view === 'board'} className={view === 'board' ? 'selected' : ''} onClick={() => selectView('board')}><ViewVerticalIcon aria-hidden="true" /><span>{tr.executionBoard}</span></button>
          <button aria-label={tr.listView} title={tr.listView} aria-pressed={view === 'list'} className={view === 'list' ? 'selected' : ''} onClick={() => selectView('list')}><RowsIcon aria-hidden="true" /><span>{tr.executionList}</span></button>
          <button aria-label={tr.scrum} title={tr.scrum} aria-pressed={view === 'scrum'} className={view === 'scrum' ? 'selected' : ''} onClick={() => selectView('scrum')}><Icon name="scrum" /><span>{tr.scrum}</span></button>
        </div>
        {filters && <div className="ws-execution-filters">{filters}</div>}
      </div>
    </div>
    <div className="ws-execution-actions">{actions}</div>
  </header>;
}
