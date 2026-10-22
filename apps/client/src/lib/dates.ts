function parts(date: Date, timeZone: string) {
  const values = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) =>
    values.find((p) => p.type === type)?.value || "";
  return `${value("year")}-${value("month")}-${value("day")}T${value("hour")}:${value("minute")}`;
}
export function dateTimeInput(date: Date, timeZone: string) {
  return parts(date, timeZone);
}
export function dayKey(date: Date, timeZone: string) {
  return parts(date, timeZone).slice(0, 10);
}
export function zonedInputToIso(value: string, timeZone: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error("Choose a valid publishing date and time.");
  const wall = Date.parse(`${value}:00Z`);
  if (!Number.isFinite(wall))
    throw new Error("Choose a valid publishing date and time.");
  const offsets = new Set<number>();
  for (const delta of [-86400000, 0, 86400000]) {
    const stamp = wall + delta;
    offsets.add(Date.parse(`${parts(new Date(stamp), timeZone)}:00Z`) - stamp);
  }
  const candidates = [...offsets]
    .map((offset) => wall - offset)
    .filter((stamp) => parts(new Date(stamp), timeZone) === value);
  if (candidates.length !== 1)
    throw new Error(
      candidates.length
        ? "This time occurs twice because of daylight saving. Choose a different time."
        : "This time does not exist in the project time zone. Choose a different time.",
    );
  return new Date(candidates[0] ?? 0).toISOString();
}
export function displayDate(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en", {
    timeZone,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
