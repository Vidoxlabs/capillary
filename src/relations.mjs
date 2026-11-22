/** Typed, append-only context relations. Contract: docs/contracts/relations.md */

export class RelationError extends Error {}

export const RELATION_TYPES = new Set([
  'derived-from', 'references', 'subsumes', 'revised-from', 'relates-to',
]);

const MAX_PARENT_HOPS = 50;

/**
 * Create one relation record. Types are closed; both endpoints are known source ids;
 * a source never relates to itself. Records are frozen — the ledger is append-only.
 */
export function relationRecord({ type, from, to }) {
  if (!RELATION_TYPES.has(type)) {
    throw new RelationError(`type must be one of ${[...RELATION_TYPES].join(', ')}.`);
  }
  if (typeof from !== 'string' || from.length === 0) throw new RelationError('from must be a non-empty source id.');
  if (typeof to !== 'string' || to.length === 0) throw new RelationError('to must be a non-empty source id.');
  if (from === to) throw new RelationError('A source never relates to itself.');
  return Object.freeze({ type, from, to });
}

/**
 * Soundness check for an append-only ledger: every record is well-formed, endpoints
 * resolve to known sources, and no duplicate (type, from, to) exists. Returns
 * { ok, errors } — any consumer can audit organization without trusting the writer.
 */
export function isSoundLedger({ sources, relations }) {
  const errors = [];
  const ids = new Set();
  if (!Array.isArray(sources)) return { ok: false, errors: ['sources must be an array of known source ids.'] };
  for (const source of sources) {
    if (typeof source === 'string') ids.add(source);
    else if (source !== null && typeof source === 'object' && typeof source.id === 'string') ids.add(source.id);
    else errors.push('sources must be source ids or source records.');
  }
  const seen = new Set();
  if (!Array.isArray(relations)) return { ok: false, errors: ['relations must be an array.'] };
  relations.forEach((record, index) => {
    if (record === null || typeof record !== 'object' || typeof record.type !== 'string') {
      errors.push(`Relation ${index} is not a well-formed record.`);
      return;
    }
    try { relationRecord(record); } catch (error) { errors.push(`Relation ${index}: ${error.message}`); }
    if (!ids.has(record.from)) errors.push(`Relation ${index} references unknown source "${record.from}".`);
    if (!ids.has(record.to)) errors.push(`Relation ${index} references unknown source "${record.to}".`);
    const key = `${record.type}|${record.from}|${record.to}`;
    if (seen.has(key)) errors.push(`Relation ${index} duplicates (${record.type}, ${record.from}, ${record.to}).`);
    seen.add(key);
  });
  return { ok: errors.length === 0, errors };
}

/** Follow explicit parent ids in a supplied map. A known root maps to null. */
export function walkParentChain({ startId, parentsById, limit = MAX_PARENT_HOPS } = {}) {
  if (typeof startId !== 'string' || startId.length === 0) throw new RelationError('startId must be a non-empty source id.');
  if (!(parentsById instanceof Map)) throw new RelationError('parentsById must be a Map.');
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > MAX_PARENT_HOPS) {
    throw new RelationError(`limit must be an integer from 0 to ${MAX_PARENT_HOPS}.`);
  }

  const parentIds = [];
  const finish = (stop, at) => Object.freeze({ parentIds: Object.freeze(parentIds), stop, at });
  if (!parentsById.has(startId)) return finish('missing', startId);

  const seen = new Set([startId]);
  let current = startId;
  while (true) {
    const parent = parentsById.get(current);
    if (parent === null) return finish('root', current);
    if (typeof parent !== 'string' || parent.length === 0) {
      throw new RelationError('A parent link must name a source id or be null at the root.');
    }
    if (parentIds.length === limit) return finish('limit', parent);
    if (seen.has(parent)) return finish('cycle', parent);
    if (!parentsById.has(parent)) return finish('missing', parent);
    parentIds.push(parent);
    seen.add(parent);
    current = parent;
  }
}
