/** A LIKE pattern for `s` anywhere, taken literally: %, _ and \ escaped with the ESCAPE character \. */
export function containsPattern(s: string): string {
  return `%${s.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
