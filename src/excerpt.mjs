/** Single-line excerpt with a declared cut. Contract: docs/contracts/retrieval.md */

/**
 * Collapse whitespace to one line and carry at most `limit` UTF-16 code units, keeping
 * a surrogate pair intact. `shortened`, `carried`, and `cut` describe any cut.
 */
export function excerpt(text, limit) {
  const line = text.trim().replace(/\s+/g, ' ');
  let carried = Math.min(limit, line.length);
  const boundary = line.slice(carried - 1, carried + 1);
  if (/[\uD800-\uDBFF][\uDC00-\uDFFF]/.test(boundary)) carried -= 1;
  const cut = line.length - carried;
  return { snippet: line.slice(0, carried), shortened: cut > 0, carried, cut };
}
