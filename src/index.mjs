/** Capillary contract modules. The retrieval service is staged; these contracts are the floor. */

export const VERSION = '0.1.0';

export * from './provenance.mjs';
export * from './packet.mjs';
export * from './relations.mjs';

/** Print the contract surface and claim labels for a quick human read. */
const about = () => `
capillary ${VERSION} — a local-first context retrieval system for agent workspaces.

Contracts (implemented):
  provenance  recordSource (id, title, 64-hex digest, origin class, originRef)
  packet      buildContextPacket (bounded, declared truncation, declared omissions)
  relations   relationRecord, isSoundLedger (typed, append-only)

Service surfaces (specified, not shipped): the index and the retrieval endpoint.
See docs/contracts/ and docs/interop.md. Nothing in this repository opens a
network listener or retrieves over the network today.
`.trim();

if (process.argv[1] && process.argv[1].endsWith('index.mjs')) {
  console.log(about());
}
