const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export function extractEmails(text: string) {
  const matches = text.match(emailPattern) ?? [];
  return Array.from(new Set(matches.map((email) => email.toLowerCase())));
}

export function toLocalDatetimeValue(date: Date) {
  const offsetMs = date.getTimezoneOffset() * 60 * 1000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

export function localDatetimeToIso(value: string) {
  return new Date(value).toISOString();
}
