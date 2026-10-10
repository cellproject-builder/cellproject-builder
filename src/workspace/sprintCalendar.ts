const DAY_MS = 86_400_000;
type DatedSprint = { id: string; startDate: string; endDate: string };

/** Calendar dates use UTC ordinals, so a day stays a day across local DST changes. */
export function calendarDay(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError('Invalid calendar date');
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new RangeError('Invalid calendar date');
  return parsed.getTime() / DAY_MS;
}

export function localCalendarDate(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export const dayDate = (day: number) => new Date(day * DAY_MS).toISOString().slice(0, 10);

export function createSprintTimeline(sprints: DatedSprint[], today = localCalendarDate()) {
  const todayDay = calendarDay(today);
  const dates = sprints.map((sprint) => ({ ...sprint, start: calendarDay(sprint.startDate), end: calendarDay(sprint.endDate) }));
  const first = Math.min(todayDay, ...dates.map((sprint) => sprint.start));
  const last = Math.max(todayDay, ...dates.map((sprint) => sprint.end));
  const padding = Math.max(2, Math.ceil((last - first + 1) * .04));
  const startDay = first - padding;
  const endDay = last + padding + 1; // Exclusive: a one-day sprint still occupies one day.
  const totalDays = endDay - startDay;
  const position = (day: number) => (day - startDay) / totalDays * 100;
  const intervals = Math.min(6, totalDays);
  const ticks = Array.from({ length: intervals + 1 }, (_, index) => {
    const day = startDay + Math.round(index * totalDays / intervals);
    return { date: dayDate(day), position: position(day) };
  });
  return {
    startDay, endDay, totalDays, ticks,
    todayPosition: position(todayDay + .5),
    rows: dates.map((sprint) => ({ id: sprint.id, startPosition: position(sprint.start), endPosition: position(sprint.end + 1) })),
  };
}
