export function asBooleanFlag(value: unknown): boolean {
  if (typeof value === 'string') {
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  return false;
}
