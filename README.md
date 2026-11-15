# Token Radar — radar-5

A token launch radar: protocols that record no token yet, ranked by what a
token would be worth if their record stayed as it is. Built for the make.fun
bounty "Build the best token launch radar" (token-radar-01, $1,325, closes
14 Dec 2026).

## How to run it

```sh
node main.ts --input <snapshot.json|directory> --output <dir>
```

Reads the sealed snapshot, writes `board.json`, `data.js`, `dashboard/`,
`screenshots/` and `dossier.json` into the output directory. Deterministic:
the same snapshot always writes the same bytes. Node 22, standard library
only; the TypeScript runs on Node's built-in type stripping.

## The model (radar-5)

```
implied = TVL × base × scale × sector × momentum × record × reach
```

Radar-5 is a calibration of radar-4, not a new guess. The 128 protocols in
the snapshot whose token trades are the peers, and the model's weights were
fitted on them with ordinary least squares on log(mcap/TVL), then checked
leave-one-out. What the peers say:

- **Scale** — the strongest finding. log(mcap/TVL) on log(TVL/T0) gives
  **−0.50** (t = −5.1, bootstrap 90% CI [−0.65, −0.36], stable in both
  halves of the peers). Market cap grows like the square root of TVL: big
  protocols trade at lower multiples. So the implied value carries a scale
  factor `(TVL/T0)^−0.50`, T0 the median live TVL ($32,575,274). A protocol
  at the reference TVL is priced at exactly the market base.
- **Growth** — the seven-day-change coefficient is −0.78 with a standard
  error of 0.95 (t = −0.8, bootstrap 90% CI [−2.22, +0.91]):
  indistinguishable from zero, and unstable across halves. Leaving growth
  out improves the held-out error. So growth stays in the model (the brief
  names it) but shrunk hard toward neutral: `exp(0.2 × z)` instead of
  radar-4's `1 + 0.8 × tanh(z)`, where z is the winsorised, median-centred
  change through tanh. A protocol with no reported change is scored at the
  median, which is exactly neutral — missing data earns no premium.
- **Age and chains** — also indistinguishable from zero (t = −0.8 and
  +0.8), so the track-record range narrows to 0.90–1.10 and reach stays
  1.00–1.10.
- **Sector** — the comparables anchor stays: each sector priced off its
  own live median, shrunk toward the market base, now with a 60-protocol
  prior (radar-4 used 30) because thin sectors are noisier than that.
  Sector factors run 0.95–1.15.

Out-of-fold error on the live peers (leave-one-out, log multiple):
radar-5 **2.127**, radar-4 2.376, plain median base 2.277. The shrunk
model predicts live multiples better than radar-4 and better than the
bare median.

- **Base** — the median market-cap/TVL of the snapshot's protocols whose
  token already trades (0.2138 from 128 live protocols). The median, not
  the mean: one live protocol trades at 400× its TVL.
- **Momentum** — the week's TVL change against the week's median change
  across pre-token protocols (−6.82%), winsorised to [−60, +120]% and
  bounded with tanh, weighted 0.2 in the exponent (range 0.82–1.22).
- **Track record** — log age: `0.90 + 0.20 × ln(1 + age/365) / ln(5)`,
  capped at four years. A protocol with no listing date is scored at the
  snapshot's median age (513 days), not at zero.
- **Reach** — log chains: `1 + 0.10 × log2(chains) / log2(9)`, capped at
  nine chains. The second chain matters more than the twentieth.

No name is ever special-cased. Every number is read off the snapshot at
run time, except the two fitted weights (the −0.50 scale exponent and the
0.2 momentum weight), which are stated in the code and on the dashboard.

## The board

226 rows: all 40 watchlist protocols plus every rankable pre-token protocol
below the $50M floor (186 early finds). Protocols whose token already
trades are never ranked; the top 24 by market cap are shown apart, at the
market's own value. Value bands are multiples of the market base: A ≥ 1.5×,
B ≥ 1.0×, C ≥ 0.6×, else D. Small protocols land higher because live
tokens trade richer at small size — the fitted scale effect, not a bonus
for being small.

Measured on the sealed snapshot (independent Python check on `board.json`):

- Spearman(implied rank vs TVL rank): **0.9796** (radar-4: 0.9521)
- Bands: **A 95 / B 70 / C 34 / D 27** — all four live
- Implied/TVL median: 0.2885 (live median 0.2138) — higher because most
  board protocols sit below the $32.6M reference TVL and small tokens
  trade richer; at the reference TVL the board prices exactly at the
  live median
- Top 5 unchanged from radar-4 (steakhouse-financial, gauntlet, veda,
  usdd, upshift); top 10 identical too — the head of the board is stable,
  the movement is in the middle

## The dashboard

A light research-ledger page: the board (sortable, filterable by sector,
chain, band, watchlist, search), a detail view per protocol with the full
factor breakdown (including the scale factor) and a seven-step farm plan,
a sector comparables table (each sector's live median multiple, so the
sector factor can be checked), and the already-trading table. No network:
`data.js` is written beside the page and loaded by a relative path. The
model strip states all six factors and the two fitted weights, with the
leave-one-out check quoted.

## What it is not

Not the starter handed in unchanged, and not radar-4 with new constants:
a different model (a peer-fitted scale elasticity, shrunk momentum and
record weights, a stronger sector prior), different farm plans, and a
different dashboard (six-factor model strip, scale column in the detail
breakdown, new methodology text). The vendored library
`vendor/makefun-board.ts` is copied verbatim from the kit, as its header
instructs.
