# Contract: bounded retrieval and provenance

Status: `specified`; the records and the packet builder are `implemented` in
`src/provenance.mjs` and `src/packet.mjs`.

## Source records

A source is admitted to the corpus with:

| Field | Contract |
| --- | --- |
| `id` | stable, non-empty identifier within the corpus |
| `title` | human-readable name |
| `digest` | 64-hex SHA-256 of the recorded content |
| `origin` | one of `url`, `repository`, `text`, `workspace-file`, `run-artifact` |
| `originRef` | the address inside its origin class: the URL, the repository path, the pasted-text label, the workspace path, the producing run and artifact |

A source whose digest cannot be given is recorded as **unknown**, not omitted, and its
excerpts never enter a packet.

## The packet

A packet answers one retrieval with bounded honesty:

```js
{
  items: [
    {
      id, sourceId, sourceDigest,
      text,            // the excerpt actually carried
      shortened,       // true when cut
      carried,         // characters admitted from this item
      cut              // characters removed from this item
    }
  ],
  omitted: [ { id, reason } ],   // items the budgets left out
  totalBudget, perItemBudget
}
```

- **Items reference their source.** An item without a source id and digest is invalid.
- **Truncation is declared.** `shortened` with carried and cut sizes — never a quiet cut.
- **Omissions are declared.** An item that did not fit is listed with its reason, not
  dropped.
- **Budgets are part of the answer.** The defaults are the family baseline — 28,000
  characters across the packet, 12,000 per item, the shape the first consumer (bloom's
  team packets) proved. Caller budgets win where stated.

## Determinism

The builder admits items in the order given, taking `min(perItemBudget, remaining)`
characters per item. Same inputs, same packet: retrieval shaping is pure and testable.

## Retrieval honesty in one line

A packet says exactly what it did: which sources, what sizes, what was cut, what was
left out, and under which budgets — so downstream readers quote context with
provenance instead of trusting prose.
