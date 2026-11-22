# Capillary workspace

Capillary is a public repository. Everything committed here can be read by anyone.

## Read order

1. `docs/charter.md` — what capillary is for, and its non-goals.
2. `docs/architecture.md` — sources, index, packets, relations.
3. `docs/contracts/` — the two contracts: bounded retrieval and context relations.
4. `docs/family.md` — the botanic naming line, and why it exists.
5. The seed repository's `docs/lexicon.md` for generalized terminology rules.

## Claim discipline

Every capability carries one of four labels, and the label must be true:

- `implemented` — code in this repository does the thing, and `npm test` exercises it.
- `specified` — a contract defines it, but no shipped code does it yet.
- `planned` — a roadmap row names it.
- `observed` — a dated run recorded evidence, kept with its receipts.

## Retrieval honesty

Capillary's oldest rule, inherited from the systems it revamps: a retrieval packet
declares what it did.

- A shortened excerpt says it was shortened, and by how much.
- An item left out for budget says it was left out.
- An unknown source, a failed read, or an unverifiable origin stays **unknown** — it is
  never reported as "no results" and never filled in from elsewhere.

## Public safety

- No credentials, tokens, account names, personal handles, hostnames, IP addresses,
  port numbers, container names, cluster names, or network topologies in any committed file.
- No binary assets.
- No invented product names. The family is `seed`, `capillary`, `myosotis`,
  `aestivation`, `drosera`, `trellis`, and `bloom`, per `docs/family.md`.
- Runtime dependencies: none. A dependency proposal is an architecture decision first.

## Verification cycle

```sh
npm test      # node --test over test/*.test.mjs
```

Every commit keeps `npm test` green. A change that touches a contract document updates
the contract modules and tests in the same commit.

## Commits

Sentence-case subject lines, imperative mood, one concern per commit, and reference the
contract that owns the behavior being changed.

## Stay in this province

This repository is context retrieval: provenance records, bounded packets, and relations. It is a peer. Seed is the floor beneath it. Myosotis, aestivation, and drosera are the other peers. Bloom is the only composer above. Trellis is outside the call path. This task does not edit them. It does not keep memory, judge a plan, pack tools, probe the family, or draw the workspace.

A packet declares truncation and omission. An unknown source stays unknown. Do not fill a gap from another repository.

## Where the other seven live

| The work | Repository |
| --- | --- |
| Run records, tool identity, provider shape | `seed` |
| Bounded retrieval and relations | `capillary` (here) |
| Consent, forget, and recall | `myosotis` |
| Plans, verdicts, and the assembly gate | `aestivation` |
| Tool faces, skills, hooks, cookbooks | `drosera` |
| Probes over those libraries | `trellis` |
| The team workspace a person opens | `bloom` |
| Family documentation, synced from every public repository | `docs` |

The naming law is `docs/family.md`. `videsign` remains the design canon.

## Skills

This file is the working method. A skill adds instructions and grants nothing. Do not add a second skill system here. A packaged copy is a drosera skill record, and it still grants nothing.

## Agents

One working method lives here. Do not add a roster, and do not edit a sibling from this checkout.

## References

Read in this order: `docs/charter.md`, `docs/architecture.md`, `docs/contracts/`, `docs/family.md`, `docs/interop.md`, then `src/`. Code and `npm test` win over a stale sentence.

## Cookbook

1. Read the charter and this file.
2. Run `npm test`.
3. Change a contract only together with the module and the test that hold it.
4. Stop at the province boundary in the table above.

This recipe is instructions. This repository ships no tool pack.

## MCP

This repository is not an MCP server. Do not commit an MCP configuration, a server address, or a credential. Retrieval leaves this repository only as data a caller already asked for. Keeping that data is myosotis's province.
