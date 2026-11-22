/** Bounded read over caller-supplied text. Contract: docs/contracts/retrieval.md */

import { recordSource } from './provenance.mjs';

const DEFAULT_TOKEN_BUDGET = 2000;
const CODE_POINTS_PER_TOKEN = 4;

function readError(code, message) {
  return Object.freeze({
    ok: false,
    untrusted: true,
    error: Object.freeze({ code, message }),
    tokenEstimate: 0,
    truncated: false,
    requestedTokenBudget: null,
    continuationAvailable: false,
  });
}

export function readSource(input) {
  const { sourceId, sources, text, tokenBudget = DEFAULT_TOKEN_BUDGET } = input ?? {};
  if (typeof sourceId !== 'string' || sourceId.length === 0 || !Array.isArray(sources) || typeof text !== 'string') {
    return readError('invalid-read', 'A read needs a source id, a list of sources, and caller-supplied text.');
  }
  if (!Number.isSafeInteger(tokenBudget) || tokenBudget <= 0) {
    return readError('invalid-token-budget', 'The token budget must be a positive whole number.');
  }

  const source = sources.find(record => record?.id === sourceId);
  if (!source) return readError('source-not-found', 'The requested source id is absent.');
  if (source.status !== 'recorded') return readError('source-unavailable', 'The requested source is unavailable.');
  let recorded;
  try {
    recorded = recordSource(source);
  } catch {
    return readError('source-unavailable', 'The requested source has invalid provenance.');
  }

  const limit = tokenBudget * CODE_POINTS_PER_TOKEN;
  let carried = 0;
  let end = 0;
  for (const point of text) {
    if (carried === limit) break;
    carried += 1;
    end += point.length;
  }
  const truncated = end < text.length;
  return Object.freeze({
    ok: true,
    untrusted: true,
    source: recorded,
    text: text.slice(0, end),
    tokenEstimate: Math.ceil(carried / CODE_POINTS_PER_TOKEN),
    truncated,
    requestedTokenBudget: tokenBudget,
    continuationAvailable: truncated,
  });
}
