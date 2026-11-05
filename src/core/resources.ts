import type { Capacity } from "./planning-model";
const dayMs = 86400000;
export const dayNumber = (date: string) =>
  Math.floor(Date.parse(date + "T00:00:00Z") / dayMs);
export const dayString = (day: number) =>
  new Date(day * dayMs).toISOString().slice(0, 10);
export function workDays(start: number, end: number, weekdays: number[]) {
  if (end < start || !weekdays.length) return 0;
  const length = end - start + 1,
    whole = Math.floor(length / 7),
    days = new Set(weekdays);
  let count = whole * days.size;
  for (let i = whole * 7; i < length; i++)
    if (days.has(new Date((start + i) * dayMs).getUTCDay())) count++;
  return count;
}
export const capacityAt = (date: string, capacity: Capacity) =>
  capacity.exceptions[date] ??
  (capacity.weekdays.includes(new Date(date + "T00:00:00Z").getUTCDay())
    ? capacity.hoursPerDay
    : 0);
export function scheduledDays(start: number, end: number, capacity: Capacity) {
  let count =
    capacity.hoursPerDay > 0 ? workDays(start, end, capacity.weekdays) : 0;
  for (const [date, hours] of Object.entries(capacity.exceptions)) {
    const day = dayNumber(date);
    if (day < start || day > end) continue;
    const ordinary =
      capacity.hoursPerDay > 0 &&
      capacity.weekdays.includes(new Date(day * dayMs).getUTCDay());
    if (ordinary && hours === 0) count--;
    else if (!ordinary && hours > 0) count++;
  }
  return count;
}
