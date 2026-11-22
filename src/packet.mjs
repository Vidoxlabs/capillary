/** The bounded, provenance-honest packet builder. Contract: docs/contracts/retrieval.md */

import { DIGEST_PATTERN, isUnknownSource } from './provenance.mjs';

export class PacketError extends Error {};

/** Why an item was left out of a packet. Closed: a new reason is a contract decision. */
export const OMISSION_REASONS = ['out-of-budget', 'unknown-source'];

function itemIdentity(item, index) {
  if (item === null || typeof item !== 'object') {
    throw new PacketError(`Item ${index} must be an object.`);
  }
  const { id, sourceId } = item;
  if (typeof id !== 'string' || id.length === 0) throw new PacketError(`Item ${index} needs a non-empty id.`);
  if (typeof sourceId !== 'string' || sourceId.length === 0) {
    throw new PacketError(`Item ${index} needs its source id; untethered prose does not enter a packet.`);
  }
  return { id, sourceId };
}

function unknownIndex(unknownSources) {
  if (!Array.isArray(unknownSources)) throw new PacketError('unknownSources must be an array of unknown-source records.');
  const byId = new Map();
  unknownSources.forEach((source, index) => {
    if (!isUnknownSource(source)) {
      throw new PacketError(`unknownSources[${index}] is not an unknown-source record; record it with recordUnknownSource.`);
    }
    if (!byId.has(source.id)) byId.set(source.id, source);
  });
  return byId;
}

/**
 * The family baseline budgets, proved by the first consumer's team packets:
 * 28,000 characters across a packet, 12,000 per item. Caller budgets win.
 */
export const BLOOM_BASELINE = Object.freeze({
  TOTAL_EXCERPT_BUDGET: 28_000,
  PER_ITEM_BUDGET: 12_000,
});

function validatedItem(item, index) {
  if (item === null || typeof item !== 'object') {
    throw new PacketError(`Item ${index} must be an object.`);
  }
  const { id, sourceId, sourceDigest, text } = item;
  if (typeof id !== 'string' || id.length === 0) throw new PacketError(`Item ${index} needs a non-empty id.`);
  if (typeof sourceId !== 'string' || sourceId.length === 0) {
    throw new PacketError(`Item ${index} needs its source id; untethered prose does not enter a packet.`);
  }
  if (typeof sourceDigest !== 'string' || !DIGEST_PATTERN.test(sourceDigest)) {
    throw new PacketError(`Item ${index} carries the 64-hex digest of the source it quotes.`);
  }
  if (typeof text !== 'string' || text.length === 0) {
    throw new PacketError(`Item ${index} needs non-empty text; a nothing excerpt is not context.`);
  }
  return { id, sourceId, sourceDigest, text, ...rankingDimensions(item, index) };
}

/**
 * Relevance and recency are separate fields, never one fused number. Relevance is a
 * finite number from the ranker, recency the source's last-change time in epoch
 * milliseconds. Either may be null when the caller did not measure it; neither is
 * filled in from the other. An item carrying a fused `score` is refused.
 */
function rankingDimensions(item, index) {
  if (Object.hasOwn(item, 'score')) {
    throw new PacketError(`Item ${index} carries a fused score; give relevance and recency as separate fields.`);
  }
  const relevance = item.relevance ?? null;
  const recency = item.recency ?? null;
  if (relevance !== null && (typeof relevance !== 'number' || !Number.isFinite(relevance))) {
    throw new PacketError(`Item ${index} relevance must be a finite number or null.`);
  }
  if (recency !== null && (!Number.isSafeInteger(recency) || recency < 0)) {
    throw new PacketError(`Item ${index} recency must be epoch milliseconds or null.`);
  }
  return { relevance, recency };
}

/**
 * Build a bounded packet. Admission is ordered and deterministic: each item carries
 * min(perItemBudget, remaining) characters; shortening is declared, never silent;
 * items the budgets leave out are listed with their reason. Sources the caller could not
 * read or verify are listed under `unknown`, and any item citing one is omitted with
 * reason `unknown-source` — an unknown source stays unknown.
 */
export function buildContextPacket({
  items,
  unknownSources = [],
  totalBudget = BLOOM_BASELINE.TOTAL_EXCERPT_BUDGET,
  perItemBudget = BLOOM_BASELINE.PER_ITEM_BUDGET,
}) {
  if (!Number.isSafeInteger(totalBudget) || totalBudget < 1) {
    throw new PacketError('totalBudget must be a positive integer.');
  }
  if (!Number.isSafeInteger(perItemBudget) || perItemBudget < 1) {
    throw new PacketError('perItemBudget must be a positive integer.');
  }
  if (!Array.isArray(items)) throw new PacketError('items must be an array.');
  const unknownById = unknownIndex(unknownSources);
  // Validate every item before admitting any, so a malformed item fails the whole packet.
  const checked = items.map((raw, index) => {
    const { id, sourceId } = itemIdentity(raw, index);
    return unknownById.has(sourceId) ? { id, unknownSource: true } : validatedItem(raw, index);
  });
  const omitted = [];
  let remaining = totalBudget;
  const admitted = [];
  for (const item of checked) {
    if (item.unknownSource) {
      omitted.push({ id: item.id, reason: 'unknown-source' });
      continue;
    }
    const take = Math.min(perItemBudget, remaining);
    if (take <= 0) {
      omitted.push({ id: item.id, reason: 'out-of-budget' });
      continue;
    }
    const carried = Math.min(take, item.text.length);
    const cut = item.text.length - carried;
    admitted.push({
      id: item.id,
      sourceId: item.sourceId,
      sourceDigest: item.sourceDigest,
      relevance: item.relevance,
      recency: item.recency,
      text: item.text.slice(0, carried),
      shortened: carried < item.text.length,
      carried,
      cut,
    });
    remaining -= carried;
  }
  const unknown = [...unknownById.values()].map(({ id, origin, originRef, reason }) => ({
    sourceId: id, origin, originRef, reason,
  }));
  return {
    items: admitted,
    omitted,
    unknown,
    totalBudget,
    perItemBudget,
  };
}
