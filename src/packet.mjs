/** The bounded, provenance-honest packet builder. Contract: docs/contracts/retrieval.md */

import { DIGEST_PATTERN } from './provenance.mjs';

export class PacketError extends Error {};

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
  return { id, sourceId, sourceDigest, text };
}

/**
 * Build a bounded packet. Admission is ordered and deterministic: each item carries
 * min(perItemBudget, remaining) characters; shortening is declared, never silent;
 * items the budgets leave out are listed with their reason.
 */
export function buildContextPacket({
  items,
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
  const checked = items.map(validatedItem);
  let remaining = totalBudget;
  const admitted = [];
  const omitted = [];
  for (const item of checked) {
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
      text: item.text.slice(0, carried),
      shortened: carried < item.text.length,
      carried,
      cut,
    });
    remaining -= carried;
  }
  return {
    items: admitted,
    omitted,
    totalBudget,
    perItemBudget,
  };
}
