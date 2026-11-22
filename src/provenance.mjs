/** Source records with provenance. Contract: docs/contracts/retrieval.md */

export const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export const ORIGIN_CLASSES = new Set([
  'url', 'repository', 'text', 'workspace-file', 'run-artifact',
]);

export class ProvenanceError extends Error {}

/**
 * Record a source. A source without a digest is not a source; an unverifiable origin
 * stays unknown and never enters a packet. Returns a frozen record.
 */
export function recordSource({ id, title, digest, origin, originRef }) {
  if (typeof id !== 'string' || id.length === 0) throw new ProvenanceError('A source needs a non-empty id.');
  if (typeof title !== 'string' || title.length === 0) throw new ProvenanceError('A source needs a title.');
  if (typeof digest !== 'string' || !DIGEST_PATTERN.test(digest)) {
    throw new ProvenanceError('A source carries the 64-hex SHA-256 digest of its content.');
  }
  if (!ORIGIN_CLASSES.has(origin)) {
    throw new ProvenanceError(`origin must be one of ${[...ORIGIN_CLASSES].join(', ')}.`);
  }
  if (typeof originRef !== 'string' || originRef.length === 0) {
    throw new ProvenanceError('A source names its originRef inside its origin class.');
  }
  return Object.freeze({ id, title, digest, origin, originRef });
}
