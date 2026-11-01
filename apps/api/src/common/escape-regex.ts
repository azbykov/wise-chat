/** Makes user input match literally inside a RegExp: "a.*" finds "a.*", not everything. */
export function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&');
}
