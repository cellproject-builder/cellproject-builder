import { useId, type CSSProperties } from 'react';
import { useLocaleStore, useT } from '@/i18n';
import type { Sprint } from './types';
import { createSprintTimeline, dayDate, localCalendarDate } from './sprintCalendar';
import './SprintTimeline.css';

export function SprintTimeline({ sprints, onSelect }: { sprints: Sprint[]; onSelect: (id: string) => void }) {
  const tr = useT().workspace;
  const locale = useLocaleStore((state) => state.locale);
  const headingId = useId();
  const descriptionId = useId();
  if (!sprints.length) return null;
  const today = localCalendarDate();
  const timeline = createSprintTimeline(sprints, today);
  const format = (date: string, year = true) => new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' as const } : {}), timeZone: 'UTC' }).format(new Date(`${date}T00:00:00Z`));
  const status = (sprint: Sprint) => sprint.status === 'active' ? tr.sprintActive : sprint.status === 'completed' ? tr.sprintCompleted : tr.planned;
  const positions = new Map(timeline.rows.map((row) => [row.id, row]));
  const showYear = timeline.totalDays > 180 || dayDate(timeline.startDay).slice(0, 4) !== dayDate(timeline.endDay).slice(0, 4);
  return <section className="ws-panel ws-sprint-timeline" aria-labelledby={headingId}>
    <div className="ws-timeline-heading"><div><h2 id={headingId}>{tr.sprintTimeline}</h2><p id={descriptionId}>{tr.sprintTimelineHint}</p></div><div className="ws-timeline-legend" aria-label={tr.status}><span className="planned">{tr.planned}</span><span className="active">{tr.sprintActive}</span><span className="completed">{tr.sprintCompleted}</span></div></div>
    <div className="ws-timeline-scroll" role="region" aria-label={tr.sprintTimeline} aria-describedby={descriptionId} tabIndex={0}>
      <div className="ws-timeline-calendar">
        <div className="ws-timeline-axis" aria-hidden="true"><span>{tr.sprint}</span><div>{timeline.ticks.map((tick, index) => <time key={tick.date} dateTime={tick.date} className={index === 0 ? 'first' : index === timeline.ticks.length - 1 ? 'last' : ''} style={{ left: `${tick.position}%` }}>{format(tick.date, showYear)}</time>)}</div></div>
        <div className="ws-timeline-guides" aria-hidden="true">{timeline.ticks.map((tick) => <i key={tick.date} style={{ left: `${tick.position}%` }} />)}<div className="ws-timeline-today" style={{ left: `${timeline.todayPosition}%` }}><span title={format(today)}>{tr.timelineToday}</span></div></div>
        {sprints.map((sprint) => {
          const row = positions.get(sprint.id)!;
          const style = { '--sprint-start': `${row.startPosition}%`, '--sprint-end': `${row.endPosition}%`, '--sprint-width': `${row.endPosition - row.startPosition}%` } as CSSProperties;
          return <button key={sprint.id} className={`ws-timeline-row ${sprint.status}`} style={style} onClick={() => onSelect(sprint.id)} aria-label={`${sprint.name}, ${status(sprint)}, ${tr.startDate}: ${format(sprint.startDate)}, ${tr.endDate}: ${format(sprint.endDate)}. ${tr.timelineOpenSprint}`}>
            <span className="ws-timeline-label"><strong title={sprint.name}>{sprint.name}</strong><small>{status(sprint)}</small></span>
            <span className="ws-timeline-track" aria-hidden="true"><span className="ws-timeline-boundary-date start">{tr.timelineStart} · {format(sprint.startDate)}</span><span className="ws-timeline-bar" /><i className="ws-timeline-boundary start" /><i className="ws-timeline-boundary end" /><span className="ws-timeline-boundary-date end">{tr.timelineEnd} · {format(sprint.endDate)}</span></span>
          </button>;
        })}
      </div>
    </div>
  </section>;
}
