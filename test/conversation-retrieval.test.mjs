import test from 'node:test';
import assert from 'node:assert/strict';

import * as capillary from '../src/index.mjs';

const message = (id, conversationId, text, recency = null, overrides = {}) => ({
  id, title: `Message ${id}`, digest: 'b'.repeat(64), origin: 'text', originRef: 'thread',
  evidenceClass: 'model-proposal', confidence: 'model-unverified',
  conversationId, text, recency, ...overrides,
});

const conversation = (id, recency, title = `Conversation ${id}`) => ({ id, title, recency });

// Thread

test('a thread returns only the requested conversation, in supplied order, with evidence class and confidence', () => {
  const messages = [
    message('m1', 'c1', 'first', 1, { evidenceClass: 'operator-intent', confidence: 'direct-operator' }),
    message('x1', 'c2', 'other conversation', 2),
    message('m2', 'c1', 'second', 3),
  ];
  const result = capillary.readThread({ conversationId: 'c1', messages, limit: 10 });
  assert.equal(result.ok, true);
  assert.equal(result.untrusted, true);
  assert.equal(result.conversationId, 'c1');
  assert.deepEqual(result.messages.map(({ sourceId, evidenceClass, confidence, text, recency }) => ({
    sourceId, evidenceClass, confidence, text, recency,
  })), [
    { sourceId: 'm1', evidenceClass: 'operator-intent', confidence: 'direct-operator', text: 'first', recency: 1 },
    { sourceId: 'm2', evidenceClass: 'model-proposal', confidence: 'model-unverified', text: 'second', recency: 3 },
  ]);
  assert.equal(result.messages[0].sourceDigest, 'b'.repeat(64));
  assert.equal(result.count, 2);
  assert.equal(result.truncated, false);
  assert.equal(result.continuationAvailable, false);
  assert.equal(result.requestedLimit, 10);
  assert.doesNotMatch(JSON.stringify(result), /[a-z]+:\/\/|other conversation/);
  assert.equal(Object.hasOwn(result, 'versions'), false);
  assert.ok(Object.isFrozen(result));
});

test('a conversation id absent from the supplied messages is an error, not an empty thread', () => {
  const result = capillary.readThread({ conversationId: 'missing', messages: [message('m1', 'c1', 'x')], limit: 5 });
  assert.equal(result.ok, false);
  assert.equal(result.untrusted, true);
  assert.equal(result.error.code, 'conversation-not-found');
  assert.deepEqual(result.messages, []);
  assert.equal(result.continuationAvailable, false);
});

test('a thread message that cannot pass recordSource fails the thread instead of being dropped', () => {
  const messages = [message('m1', 'c1', 'fine'), message('m2', 'c1', 'no class', null, { evidenceClass: undefined })];
  const result = capillary.readThread({ conversationId: 'c1', messages, limit: 5 });
  assert.equal(result.ok, false);
  assert.equal(result.untrusted, true);
  assert.equal(result.error.code, 'invalid-thread-message');
  assert.deepEqual(result.messages, []);
  assert.doesNotMatch(JSON.stringify(result), /fine/);
});

test('a thread longer than the limit is cut and declares continuation', () => {
  const messages = Array.from({ length: 4 }, (_, index) => message(`m${index}`, 'c1', `text ${index}`));
  const result = capillary.readThread({ conversationId: 'c1', messages, limit: 3 });
  assert.equal(result.ok, true);
  assert.deepEqual(result.messages.map(item => item.sourceId), ['m0', 'm1', 'm2']);
  assert.equal(result.truncated, true);
  assert.equal(result.continuationAvailable, true);
  assert.equal(result.count, 3);
});

test('the thread ceiling is 200 whatever limit the caller passes', () => {
  const messages = Array.from({ length: 205 }, (_, index) => message(`m${index}`, 'c1', 't'));
  const result = capillary.readThread({ conversationId: 'c1', messages, limit: 500 });
  assert.equal(result.ok, true);
  assert.equal(result.count, 200);
  assert.equal(result.requestedLimit, 500);
  assert.equal(result.appliedLimit, 200);
  assert.equal(result.truncated, true);
  assert.equal(result.continuationAvailable, true);
  assert.equal(capillary.THREAD_MESSAGE_CEILING, 200);

  const within = capillary.readThread({ conversationId: 'c1', messages: messages.slice(0, 200), limit: 200 });
  assert.equal(within.truncated, false);
  assert.equal(within.continuationAvailable, false);
});

test('a thread without a positive limit is an untrusted error', () => {
  for (const limit of [undefined, 0, -1, 1.5]) {
    const result = capillary.readThread({ conversationId: 'c1', messages: [message('m1', 'c1', 'x')], limit });
    assert.equal(result.ok, false);
    assert.equal(result.untrusted, true);
    assert.equal(result.error.code, 'invalid-limit');
  }
});

// Recent

test('recent orders by caller-supplied recency, newest first, and defaults to five', async () => {
  const conversations = [1, 7, 3, 9, 5, 2].map(recency => conversation(`c${recency}`, recency));
  const result = await capillary.listRecent({ conversations });
  assert.equal(result.ok, true);
  assert.equal(result.untrusted, true);
  assert.deepEqual(result.conversations.map(item => item.conversationId), ['c9', 'c7', 'c5', 'c3', 'c2']);
  assert.deepEqual(result.conversations[0], { conversationId: 'c9', title: 'Conversation c9', recency: 9 });
  assert.equal(result.count, 5);
  assert.equal(result.requestedLimit, 5);
  assert.equal(result.truncated, true);
  assert.equal(result.continuationAvailable, true);
  assert.doesNotMatch(JSON.stringify(result), /[a-z]+:\/\//);
});

test('recent keeps the later supplied conversation first on a recency tie and invents no clock', async () => {
  const realNow = Date.now;
  Date.now = () => { throw new Error('recent must not read the clock'); };
  try {
    const result = await capillary.listRecent({
      conversations: [conversation('early', 4), conversation('late', 4), conversation('old', 1)], limit: 3,
    });
    assert.deepEqual(result.conversations.map(item => item.conversationId), ['late', 'early', 'old']);
    assert.equal(result.truncated, false);
    assert.equal(result.continuationAvailable, false);
  } finally {
    Date.now = realNow;
  }
});

test('an empty recent input is a successful empty list', async () => {
  const result = await capillary.listRecent({ conversations: [] });
  assert.equal(result.ok, true);
  assert.equal(result.untrusted, true);
  assert.deepEqual(result.conversations, []);
  assert.equal(result.count, 0);
  assert.equal(result.truncated, false);
});

test('recent refuses a non-positive limit and a record without recency', async () => {
  for (const limit of [0, -2, 2.5]) {
    const result = await capillary.listRecent({ conversations: [conversation('c1', 1)], limit });
    assert.equal(result.ok, false);
    assert.equal(result.untrusted, true);
    assert.equal(result.error.code, 'invalid-limit');
    assert.deepEqual(result.conversations, []);
  }
  const noRecency = await capillary.listRecent({ conversations: [{ id: 'c1', title: 'x', recency: null }] });
  assert.equal(noRecency.error.code, 'invalid-recent-record');
});

test('recent refuses a moved deletion epoch and returns no conversations', async () => {
  let epoch = 3;
  const conversations = [{
    id: 'c1',
    get title() { epoch = 4; return 'private title'; },
    recency: 1,
  }];
  const stale = await capillary.listRecent({ conversations, readEpoch: () => epoch });
  assert.equal(stale.ok, false);
  assert.equal(stale.untrusted, true);
  assert.equal(stale.refused, true);
  assert.equal(stale.code, 'deletion-epoch-changed');
  assert.deepEqual([stale.epochStart, stale.epochEnd], [3, 4]);
  assert.deepEqual(stale.conversations, []);
  assert.doesNotMatch(JSON.stringify(stale), /private title/);

  const stable = await capillary.listRecent({ conversations: [conversation('c1', 1)], readEpoch: async () => 4 });
  assert.equal(stable.ok, true);
  assert.equal(stable.deletionEpoch, 4);
  assert.equal(stable.count, 1);
});

// Context

test('the context brief picks the newest operator intent and verified outcome', () => {
  const records = [
    message('goal-old', 'c1', 'older goal', 1, { evidenceClass: 'operator-intent', confidence: 'direct-operator' }),
    message('goal-new', 'c1', 'newer goal', 5, { evidenceClass: 'operator-intent', confidence: 'direct-operator' }),
    message('done', 'c1', 'tests passed', 3, { evidenceClass: 'verified-outcome', confidence: 'direct-tool' }),
    message('proposal', 'c1', 'newest proposal', 9),
  ];
  const result = capillary.contextBrief({ records });
  assert.equal(result.ok, true);
  assert.equal(result.untrusted, true);
  assert.equal(result.query, null);
  assert.deepEqual(result.brief.openFollowups, []);
  const { latestOperatorGoal: goal, latestVerifiedOutcome: outcome } = result.brief;
  assert.deepEqual(goal, {
    sourceId: 'goal-new', sourceDigest: 'b'.repeat(64), title: 'Message goal-new',
    evidenceClass: 'operator-intent', confidence: 'direct-operator', recency: 5,
    excerpt: 'newer goal', shortened: false, carried: 10, cut: 0,
  });
  assert.equal(outcome.sourceId, 'done');
  assert.equal(outcome.evidenceClass, 'verified-outcome');
  assert.doesNotMatch(JSON.stringify(result), /[a-z]+:\/\//);
});

test('an absent evidence class leaves its brief field null', () => {
  const result = capillary.contextBrief({ records: [message('proposal', 'c1', 'a proposal', 2)] });
  assert.equal(result.ok, true);
  assert.equal(result.brief.latestOperatorGoal, null);
  assert.equal(result.brief.latestVerifiedOutcome, null);
  const empty = capillary.contextBrief({ records: [] });
  assert.equal(empty.ok, true);
  assert.equal(empty.brief.latestOperatorGoal, null);
});

test('on a recency tie the later supplied record wins', () => {
  const intent = { evidenceClass: 'operator-intent', confidence: 'direct-operator' };
  const records = [
    message('first', 'c1', 'first goal', 4, intent),
    message('second', 'c1', 'second goal', 4, intent),
    message('older', 'c1', 'older goal', 2, intent),
  ];
  assert.equal(capillary.contextBrief({ records }).brief.latestOperatorGoal.sourceId, 'second');
});

test('a supplied query is returned unchanged and does not filter the records', () => {
  const records = [message('goal', 'c1', 'unrelated goal', 1, { evidenceClass: 'operator-intent', confidence: 'direct-operator' })];
  const result = capillary.contextBrief({ records, query: '  Something Else  ' });
  assert.equal(result.query, '  Something Else  ');
  assert.equal(result.brief.latestOperatorGoal.sourceId, 'goal');
});

test('a cut brief excerpt declares shortened the way search does', () => {
  const records = [message('goal', 'c1', 'a  long\n goal text', 1, { evidenceClass: 'operator-intent', confidence: 'direct-operator' })];
  const goal = capillary.contextBrief({ records, excerptChars: 6 }).brief.latestOperatorGoal;
  assert.deepEqual({ excerpt: goal.excerpt, shortened: goal.shortened, carried: goal.carried, cut: goal.cut }, {
    excerpt: 'a long', shortened: true, carried: 6, cut: 10,
  });
});

test('a brief record that cannot pass recordSource or lacks recency is an error', () => {
  for (const records of [
    [message('bad', 'c1', 'x', 1, { confidence: undefined })],
    [message('no-recency', 'c1', 'x', null)],
  ]) {
    const result = capillary.contextBrief({ records });
    assert.equal(result.ok, false);
    assert.equal(result.untrusted, true);
    assert.equal(result.error.code, 'invalid-context-record');
    assert.equal(Object.hasOwn(result, 'brief'), false);
  }
});

// Trace

test('trace wraps the parent walk in an untrusted envelope without fetching versions', () => {
  const parentsById = new Map([['child', 'parent'], ['parent', 'root'], ['root', null]]);
  const result = capillary.traceSource({ startId: 'child', parentsById });
  assert.deepEqual({ ...result, parentIds: [...result.parentIds] }, {
    ok: true, untrusted: true, startId: 'child', parentIds: ['parent', 'root'], stop: 'root', at: 'root',
  });
  assert.equal(Object.hasOwn(result, 'versions'), false);
});

test('a missing trace start stays missing and gets no invented parent', () => {
  const result = capillary.traceSource({ startId: 'ghost', parentsById: new Map([['other', null]]) });
  assert.equal(result.ok, true);
  assert.equal(result.untrusted, true);
  assert.equal(result.stop, 'missing');
  assert.equal(result.at, 'ghost');
  assert.deepEqual([...result.parentIds], []);
});

test('trace includes versions only when the caller supplies them', () => {
  const versions = [{ revision: 1 }, { revision: 2 }];
  const result = capillary.traceSource({ startId: 'a', parentsById: new Map([['a', null]]), versions });
  assert.deepEqual(result.versions, versions);
  assert.notEqual(result.versions, versions);
  assert.ok(Object.isFrozen(result.versions));
});

test('a malformed trace request is an untrusted error, not a throw', () => {
  for (const input of [
    { startId: '', parentsById: new Map() },
    { startId: 'a', parentsById: {} },
    { startId: 'a', parentsById: new Map([['a', null]]), versions: 'v1' },
    { startId: 'a', parentsById: new Map([['a', 7]]) },
  ]) {
    const result = capillary.traceSource(input);
    assert.equal(result.ok, false);
    assert.equal(result.untrusted, true);
    assert.equal(result.error.code, 'invalid-trace');
  }
});
