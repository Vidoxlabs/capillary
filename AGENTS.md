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
- No invented product names; the botanic family line (`seed`, `capillary`, `myosotis`,
  `aestivation`, `bloom`) is the naming law for new public products, per `docs/family.md`.
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
