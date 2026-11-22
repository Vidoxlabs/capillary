/** Source records with provenance. Contract: docs/contracts/retrieval.md */

export const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

export const ORIGIN_CLASSES = new Set([
  'url', 'repository', 'text', 'workspace-file', 'run-artifact',
]);

const EVIDENCE_CLASSES = [
  'operator-intent', 'operator-constraint', 'model-proposal', 'model-analysis',
  'tool-observation', 'verified-outcome', 'unverified-claim', 'system-metadata',
];
const CONFIDENCE_CLASSES = [
  'direct-operator', 'direct-tool', 'model-with-evidence', 'model-unverified',
  'historical-summary', 'derived',
];

export class ProvenanceError extends Error {}

/**
 * Record a source. A source without a digest is not a source; an unverifiable origin
 * stays unknown and never enters a packet. Returns a frozen record.
 */
export function recordSource({ id, title, digest, origin, originRef, evidenceClass, confidence }) {
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
  if (!EVIDENCE_CLASSES.includes(evidenceClass)) {
    throw new ProvenanceError(`evidenceClass must be one of ${EVIDENCE_CLASSES.join(', ')}.`);
  }
  if (!CONFIDENCE_CLASSES.includes(confidence)) {
    throw new ProvenanceError(`confidence must be one of ${CONFIDENCE_CLASSES.join(', ')}.`);
  }
  return Object.freeze({ id, title, digest, origin, originRef, evidenceClass, confidence, status: 'recorded' });
}

/** Why a source stayed unknown. Closed: a new reason is a contract decision. */
export const UNKNOWN_REASONS = ['not-found', 'read-failed', 'digest-unavailable'];

/**
 * Record a source that could not be read or verified. It stays unknown: the digest is
 * null, the record is frozen so nothing fills it in later, and its excerpts never enter
 * a packet. The record still names where retrieval looked and why it failed.
 */
export function recordUnknownSource({ id, title = null, origin, originRef, reason }) {
  if (typeof id !== 'string' || id.length === 0) throw new ProvenanceError('An unknown source still needs a non-empty id.');
  if (title !== null && (typeof title !== 'string' || title.length === 0)) {
    throw new ProvenanceError('An unknown source title is a non-empty string or null.');
  }
  if (!ORIGIN_CLASSES.has(origin)) {
    throw new ProvenanceError(`origin must be one of ${[...ORIGIN_CLASSES].join(', ')}.`);
  }
  if (typeof originRef !== 'string' || originRef.length === 0) {
    throw new ProvenanceError('An unknown source names the originRef retrieval looked at.');
  }
  if (!UNKNOWN_REASONS.includes(reason)) {
    throw new ProvenanceError(`An unknown source states its reason: one of ${UNKNOWN_REASONS.join(', ')}.`);
  }
  return Object.freeze({ id, title, digest: null, origin, originRef, status: 'unknown', reason });
}

/** True only for a well-formed unknown-source record. */
export function isUnknownSource(source) {
  return source !== null && typeof source === 'object'
    && source.status === 'unknown'
    && source.digest === null
    && typeof source.id === 'string' && source.id.length > 0
    && ORIGIN_CLASSES.has(source.origin)
    && typeof source.originRef === 'string' && source.originRef.length > 0
    && UNKNOWN_REASONS.includes(source.reason);
}
