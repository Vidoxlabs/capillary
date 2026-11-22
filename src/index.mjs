/** Capillary contract modules. The retrieval service is staged; these contracts are the floor. */

export const VERSION = '1.3.0';

export * from './provenance.mjs';
export * from './packet.mjs';
export * from './relations.mjs';
export { buildEpochGuardedPacket, EPOCH_REFUSALS } from './epoch-guard.mjs';
export { readSource } from './read.mjs';
export { searchSources } from './search.mjs';
export { readThread, listRecent, contextBrief, traceSource, THREAD_MESSAGE_CEILING } from './conversation.mjs';

/** Print the contract surface and claim labels for a quick human read. */
const about = () => `
capillary ${VERSION} — a local-first context retrieval system for agent workspaces.

Contracts (implemented):
  provenance  recordSource (digest, origin, evidenceClass, confidence),
              recordUnknownSource, isUnknownSource (unknown stays unknown)
  packet      buildContextPacket (bounded, declared truncation, omissions, unknowns,
              relevance and recency as separate fields)
  epoch-guard buildEpochGuardedPacket (refuses a read the deletion epoch moved under)
  read        readSource (caller text, estimated token budget, untrusted envelope)
  search      searchSources (literal matches, declared snippet cuts, untrusted envelope)
  conversation readThread (one conversation, ceiling 200, declared continuation),
              listRecent (caller recency, newest first, epoch refusal),
              contextBrief (newest operator intent and verified outcome, or null),
              traceSource (untrusted envelope around walkParentChain)
  relations   relationRecord, isSoundLedger (typed, append-only)
              walkParentChain (bounded walk of supplied parent ids)

Service surfaces (specified, not shipped): the index and the retrieval endpoint.
See docs/contracts/ and docs/interop.md. Nothing in this repository opens a
network listener or retrieves over the network today.
`.trim();

if (process.argv[1] && process.argv[1].endsWith('index.mjs')) {
  console.log(about());
}
