/**
 * Thread, recent, context brief, and trace over caller-supplied records.
 * Contract: docs/contracts/retrieval.md ("Conversation retrieval").
 *
 * Every result carries `untrusted: true`, an error included. Nothing here fetches,
 * caches, reads a clock, emits pointer strings, or opens a listener.
 */

import { readAtStableEpoch } from './epoch-guard.mjs';
import { excerpt } from './excerpt.mjs';
import { recordSource } from './provenance.mjs';
import { walkParentChain } from './relations.mjs';

export const THREAD_MESSAGE_CEILING = 200;
const DEFAULT_RECENT_LIMIT = 5;
const DEFAULT_EXCERPT_CHARS = 160;

const isPositiveInteger = (value) => Number.isSafeInteger(value) && value > 0;
const isRecency = (value) => Number.isSafeInteger(value) && value >= 0;
const isNonEmptyString = (value) => typeof value === 'string' && value.length > 0;

const errorFields = (code, message) => ({ ok: false, untrusted: true, error: Object.freeze({ code, message }) });

/** Validate one source-shaped record carrying text. Returns the frozen source or null. */
function recordedWithText(record) {
  if (record === null || typeof record !== 'object') return null;
  if (typeof record.text !== 'string') return null;
  if (record.status !== undefined && record.status !== 'recorded') return null;
  try {
    return recordSource(record);
  } catch {
    return null;
  }
}

function sourceFields(source) {
  const { id: sourceId, digest: sourceDigest, title, evidenceClass, confidence } = source;
  return { sourceId, sourceDigest, title, evidenceClass, confidence };
}

// Thread

function threadError(code, message) {
  return Object.freeze({
    ...errorFields(code, message),
    messages: Object.freeze([]), count: 0, truncated: false, continuationAvailable: false,
  });
}

/**
 * The messages of one conversation, in supplied order. Each message is a source record
 * with `conversationId`, `text`, and `recency` (epoch ms or null). The caller passes a
 * positive `limit`; the applied limit never exceeds THREAD_MESSAGE_CEILING.
 */
export function readThread(input) {
  const { conversationId, messages, limit } = input ?? {};
  if (!isNonEmptyString(conversationId) || !Array.isArray(messages)) {
    return threadError('invalid-thread', 'A thread needs a conversation id and a list of messages.');
  }
  if (!isPositiveInteger(limit)) return threadError('invalid-limit', 'The limit must be a positive whole number.');
  if (messages.some(item => item === null || typeof item !== 'object' || !isNonEmptyString(item.conversationId))) {
    return threadError('invalid-thread', 'Every supplied message names its conversation id.');
  }

  const inThread = messages.filter(item => item.conversationId === conversationId);
  if (inThread.length === 0) return threadError('conversation-not-found', 'The requested conversation id is absent.');

  const checked = [];
  for (const item of inThread) {
    const source = recordedWithText(item);
    const recency = item.recency ?? null;
    if (source === null || (recency !== null && !isRecency(recency))) {
      return threadError('invalid-thread-message', 'A message in this thread has invalid provenance, text, or recency.');
    }
    checked.push(Object.freeze({ ...sourceFields(source), recency, text: item.text }));
  }

  const appliedLimit = Math.min(limit, THREAD_MESSAGE_CEILING);
  const truncated = checked.length > appliedLimit;
  const carried = checked.slice(0, appliedLimit);
  return Object.freeze({
    ok: true,
    untrusted: true,
    conversationId,
    messages: Object.freeze(carried),
    count: carried.length,
    truncated,
    requestedLimit: limit,
    appliedLimit,
    continuationAvailable: truncated,
  });
}

// Recent

function recentResult(ok, conversations, fields = {}) {
  return Object.freeze({
    ok, untrusted: true, conversations: Object.freeze(conversations), count: conversations.length,
    truncated: false, continuationAvailable: false, ...fields,
  });
}

const recentError = (code, message) => recentResult(false, [], { error: Object.freeze({ code, message }) });

function orderRecent(conversations, limit) {
  const rows = [];
  for (const [index, item] of conversations.entries()) {
    if (item === null || typeof item !== 'object') {
      return recentError('invalid-recent-record', 'A recent record must be an object.');
    }
    const { id, title, recency } = item;
    if (!isNonEmptyString(id) || (title !== null && !isNonEmptyString(title)) || !isRecency(recency)) {
      return recentError('invalid-recent-record', 'A recent record needs an id, a title or null, and its recency.');
    }
    rows.push({ index, row: Object.freeze({ conversationId: id, title, recency }) });
  }
  // Newest first by the caller's recency; on a tie the later supplied record comes first.
  rows.sort((a, b) => (b.row.recency - a.row.recency) || (b.index - a.index));
  const truncated = rows.length > limit;
  return recentResult(true, rows.slice(0, limit).map(entry => entry.row), {
    truncated, requestedLimit: limit, continuationAvailable: truncated,
  });
}

/**
 * Recent conversations, newest first by caller-supplied `recency`. With optional
 * `readEpoch`, the deletion-epoch guard brackets the ordering.
 */
export async function listRecent(input) {
  const { conversations, limit = DEFAULT_RECENT_LIMIT, readEpoch } = input ?? {};
  if (!Array.isArray(conversations) || (readEpoch !== undefined && typeof readEpoch !== 'function')) {
    return recentError('invalid-recent', 'Recent needs a list of conversation records.');
  }
  if (!isPositiveInteger(limit)) return recentError('invalid-limit', 'The limit must be a positive whole number.');
  if (readEpoch === undefined) return orderRecent(conversations, limit);

  const checked = await readAtStableEpoch(readEpoch, () => orderRecent(conversations, limit));
  if (checked.refused) return recentResult(false, [], checked);
  return Object.freeze({ ...checked.rows, deletionEpoch: checked.deletionEpoch });
}

// Context

const contextError = (code, message) => Object.freeze(errorFields(code, message));

function briefEntry(record, source, excerptChars) {
  const { snippet, shortened, carried, cut } = excerpt(record.text, excerptChars);
  return Object.freeze({
    ...sourceFields(source), recency: record.recency, excerpt: snippet, shortened, carried, cut,
  });
}

/**
 * A brief over caller-supplied records: the newest `operator-intent` and the newest
 * `verified-outcome`, each null when absent. A tie on recency goes to the later
 * supplied record. The query is echoed and filters nothing.
 */
export function contextBrief(input) {
  const { records, query = null, excerptChars = DEFAULT_EXCERPT_CHARS } = input ?? {};
  if (!Array.isArray(records) || (query !== null && typeof query !== 'string') || !isPositiveInteger(excerptChars)) {
    return contextError('invalid-context', 'A brief needs a record list, a string query or none, and a positive excerpt limit.');
  }
  const latest = { 'operator-intent': null, 'verified-outcome': null };
  for (const record of records) {
    const source = recordedWithText(record);
    if (source === null || !isRecency(record.recency)) {
      return contextError('invalid-context-record', 'A brief record has invalid provenance, text, or recency.');
    }
    const current = latest[source.evidenceClass];
    if (current === undefined) continue;
    if (current === null || record.recency >= current.record.recency) latest[source.evidenceClass] = { record, source };
  }
  const entry = (found) => (found === null ? null : briefEntry(found.record, found.source, excerptChars));
  return Object.freeze({
    ok: true,
    untrusted: true,
    query,
    brief: Object.freeze({
      latestOperatorGoal: entry(latest['operator-intent']),
      latestVerifiedOutcome: entry(latest['verified-outcome']),
      openFollowups: Object.freeze([]),
    }),
  });
}

// Trace

/**
 * An untrusted envelope around walkParentChain. Versions appear only when the caller
 * supplies them as an array; the function never fetches them.
 */
export function traceSource(input) {
  const { startId, parentsById, limit, versions } = input ?? {};
  if (versions !== undefined && !Array.isArray(versions)) {
    return contextError('invalid-trace', 'Versions, when supplied, are an array.');
  }
  let walk;
  try {
    walk = walkParentChain({ startId, parentsById, ...(limit === undefined ? {} : { limit }) });
  } catch (error) {
    return contextError('invalid-trace', error.message);
  }
  return Object.freeze({
    ok: true,
    untrusted: true,
    startId,
    parentIds: walk.parentIds,
    stop: walk.stop,
    at: walk.at,
    ...(versions === undefined ? {} : { versions: Object.freeze([...versions]) }),
  });
}
