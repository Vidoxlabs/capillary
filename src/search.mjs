/** Literal search over supplied source records. Contract: docs/contracts/retrieval.md */

import { readAtStableEpoch } from './epoch-guard.mjs';
import { excerpt } from './excerpt.mjs';
import { recordSource } from './provenance.mjs';

const DEFAULT_SNIPPET_CHARS = 160;

function searchError(code, message) {
  return searchResult(false, [], { error: Object.freeze({ code, message }) });
}

function searchResult(ok, hits, fields = {}) {
  return Object.freeze({ ok, untrusted: true, hits: Object.freeze(hits), count: hits.length, ...fields });
}

function countMatches(text, needle) {
  const lower = text.toLowerCase();
  let relevance = 0;
  for (let index = lower.indexOf(needle); index !== -1; index = lower.indexOf(needle, index + needle.length)) {
    relevance += 1;
  }
  return relevance;
}

function findHits(records, needle, snippetChars) {
  const hits = [];
  for (const record of records) {
    if (record === null || typeof record !== 'object') {
      return searchError('invalid-search-record', 'Search needs source records with text and recency.');
    }
    if (Object.hasOwn(record, 'score')) {
      return searchError('fused-score', 'Search computes relevance from literal matches and keeps recency separate.');
    }
    const { text, recency, status } = record;
    if (typeof text !== 'string'
        || (recency !== null && (!Number.isSafeInteger(recency) || recency < 0))
        || (status !== undefined && status !== 'recorded')) {
      return searchError('invalid-search-record', 'Search needs recorded sources with text and recency.');
    }
    let source;
    try {
      source = recordSource(record);
    } catch {
      return searchError('invalid-search-record', 'A search record has invalid provenance.');
    }

    const relevance = countMatches(text, needle);
    if (relevance === 0) continue;
    const { id: sourceId, digest: sourceDigest, title, evidenceClass, confidence } = source;
    hits.push(Object.freeze({
      sourceId, sourceDigest, title, evidenceClass, confidence, relevance, recency,
      ...excerpt(text, snippetChars),
    }));
  }
  return searchResult(true, hits);
}

export async function searchSources(input) {
  const { query, records, snippetChars = DEFAULT_SNIPPET_CHARS, readEpoch } = input ?? {};
  if (typeof query !== 'string' || query.trim().length === 0 || !Array.isArray(records)
      || !Number.isSafeInteger(snippetChars) || snippetChars < 1
      || (readEpoch !== undefined && typeof readEpoch !== 'function')) {
    return searchError('invalid-search', 'Search needs a literal query, a record list, and a positive snippet limit.');
  }

  const needle = query.trim().toLowerCase();
  if (readEpoch === undefined) return findHits(records, needle, snippetChars);

  const checked = await readAtStableEpoch(readEpoch, () => findHits(records, needle, snippetChars));
  if (checked.refused) return searchResult(false, [], checked);
  return Object.freeze({ ...checked.rows, deletionEpoch: checked.deletionEpoch });
}
