/**
 * Compares a secret with what a request sent in constant time for equal
 * lengths, so the answer time does not tell how much of it matched
 */
export const secureEqual = (
  a: string | null | undefined,
  b: string | null | undefined,
) => {
  if (a == null || b == null) return false;
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let diff = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index++) {
    diff |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return diff === 0;
};
