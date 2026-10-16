/**
 * Quote a value as exactly one shell word. Paths in remote commands are built
 * from repository and folder names that users control, so every interpolated
 * value goes through this — double quotes are not enough, they still expand
 * `$(...)` and backticks.
 */
export function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}
