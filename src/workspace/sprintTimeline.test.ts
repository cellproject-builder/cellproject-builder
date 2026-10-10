import { describe, expect, it } from 'vitest';
import { calendarDay, createSprintTimeline, localCalendarDate } from './sprintCalendar';

describe('sprint calendar timeline', () => {
  it('counts calendar days across daylight saving and leap dates', () => {
    expect(calendarDay('2024-11-04') - calendarDay('2024-11-02')).toBe(2);
    expect(calendarDay('2024-03-11') - calendarDay('2024-03-09')).toBe(2);
    expect(calendarDay('2024-03-01') - calendarDay('2024-02-28')).toBe(2);
    expect(() => calendarDay('2024-02-30')).toThrow();
    expect(localCalendarDate(new Date(2026, 9, 9, 23, 59))).toBe('2026-10-09');
  });

  it('includes every sprint and today with a positive one-day span', () => {
    const timeline = createSprintTimeline([
      { id: 'past', startDate: '2026-01-01', endDate: '2026-01-03' },
      { id: 'one-day', startDate: '2026-10-09', endDate: '2026-10-09' },
      { id: 'future', startDate: '2027-01-01', endDate: '2027-01-15' },
    ], '2026-10-09');
    expect(timeline.startDay).toBeLessThan(calendarDay('2026-01-01'));
    expect(timeline.endDay).toBeGreaterThan(calendarDay('2027-01-15'));
    expect(timeline.todayPosition).toBeGreaterThan(0);
    expect(timeline.todayPosition).toBeLessThan(100);
    const day = timeline.rows.find((row) => row.id === 'one-day')!;
    expect(day.endPosition - day.startPosition).toBeCloseTo(100 / timeline.totalDays);
    expect(day.endPosition).toBeGreaterThan(day.startPosition);
  });

  it('keeps long periods readable with at most seven chronological ticks', () => {
    const timeline = createSprintTimeline([{ id: 'long', startDate: '2000-01-01', endDate: '2050-12-31' }], '2026-10-09');
    expect(timeline.ticks.length).toBeLessThanOrEqual(7);
    expect(timeline.ticks[0].position).toBe(0);
    expect(timeline.ticks.at(-1)?.position).toBe(100);
    expect(new Set(timeline.ticks.map((tick) => tick.date)).size).toBe(timeline.ticks.length);
    expect(timeline.rows[0].startPosition).toBeGreaterThan(0);
    expect(timeline.rows[0].endPosition).toBeLessThan(100);
  });
});
