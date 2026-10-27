/** Quote a string as a Cypher string literal. */
export function quote(value: string): string {
  return JSON.stringify(value);
}
