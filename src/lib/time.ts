export function nowIso(): string {
  return new Date().toISOString();
}

export function ymdParts(date = new Date()): { y: string; m: string; d: string } {
  const y = String(date.getUTCFullYear());
  const m = String(date.getUTCMonth() + 1).padStart(2, "0");
  const d = String(date.getUTCDate()).padStart(2, "0");
  return { y, m, d };
}

export function isIsoDateNewer(next?: string, prev?: string): boolean {
  if (!next) return false;
  if (!prev) return true;
  return new Date(next).getTime() > new Date(prev).getTime();
}
