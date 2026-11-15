// Radar-5: a token launch radar that prices a protocol the way the market
// for tokens that already trade prices it — off the market itself, in the
// protocol's own sector, at the protocol's own scale.
//
// The board ranks every protocol on the snapshot's watchlist plus the
// rankable pre-token protocols below the floor. A protocol whose token
// already trades is never ranked; it is shown apart, at the market's own
// value, because its price is a fact and the board's numbers are a claim.
//
// How the model was built (radar-5 is a calibration, not a new guess):
// the 128 protocols in the snapshot whose token trades are the peers, and
// the model's weights were fitted on them with ordinary least squares on
// log(mcap/TVL), then checked out of fold. What the peers say:
//
//   * Scale: log(mcap/TVL) on log(TVL/T0) gives -0.50 (t = -5.1, bootstrap
//     90% CI [-0.65, -0.36], stable in both halves). Market cap grows like
//     the square root of TVL: big protocols trade at lower multiples. So
//     the implied value carries a scale factor (TVL/T0)^-0.50, T0 the median
//     live TVL ($32.6M). This is the model's strongest peer finding.
//   * Growth: the seven-day-change coefficient is -0.78 with a standard
//     error of 0.95 (t = -0.8, bootstrap 90% CI [-2.22, +0.91]) —
//     indistinguishable from zero, and unstable across halves. Leaving
//     growth out improves the held-out error, so growth is kept in the
//     model (the brief names it) but shrunk hard toward neutral:
//     exp(0.2 * z) instead of radar-4's 1 + 0.8 * tanh(z).
//   * Age and chains: also indistinguishable from zero (t = -0.8 and +0.8),
//     so the track-record range narrows to 0.90-1.10 and reach stays small.
//   * Out-of-fold error (leave-one-out, log multiple): radar-5 2.127,
//     radar-4 2.376, plain median base 2.277. The shrunk model predicts
//     live multiples better than radar-4 and better than the bare median.
//
//   implied = TVL x base x scale x sector x momentum x record x reach
//
//   1. The market base. The median market-cap/TVL of the snapshot's live
//      protocols (0.2138). The median, not the mean: one live protocol
//      trades at 400x its TVL and the mean would follow it.
//   2. A scale factor. (TVL/T0)^-0.50, clamped to [0.05, 20] as a guardrail
//      (on this snapshot it runs 0.11-2.55). A protocol at the reference
//      TVL is priced at exactly the market base; smaller ones richer,
//      larger ones cheaper — the way live tokens actually trade.
//   3. A sector multiple. Each sector's own live median, shrunk toward the
//      market base with a 60-protocol prior (radar-4 used 30; the peers
//      say thin sectors are noisier than that), damped halfway. Sectors
//      with fewer than three live protocols fall back to the market.
//   4. A momentum term. The week's TVL change against the week's median
//      change across pre-token protocols, winsorised to [-60, +120]% and
//      passed through tanh, then weighted by 0.2 in the exponent — a small
//      nudge, not a verdict, because the peers show no reliable link
//      between one week's growth and the multiple.
//   5. A track-record term. Log age, 0.90-1.10: the first year of running
//      with no token is worth more than the fourth. A protocol with no
//      listing date is scored at the snapshot's median age, not at zero.
//   6. A reach term. Log chains, 1.00-1.10, capped at nine chains: the
//      second chain matters more than the twentieth.
//
// No name is ever special-cased. Every number is read off the snapshot at
// run time, except the two fitted weights (the -0.50 scale exponent and the
// 0.2 momentum weight), which are stated here and on the dashboard.

/** One protocol as the sealed snapshot carries it: exactly ten fields. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The sealed snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's constants: the shape of the curves, stated on the dashboard. */
export interface ModelSpec {
  /** Scale exponent on (TVL / scale_ref_tvl), fitted on the live peers. */
  scale_exponent: number;
  /** Shrinkage prior (in protocols) pulling a sector multiple toward the market base. */
  sector_prior: number;
  /** Minimum live protocols in a sector before it prices off its own median. */
  sector_min_live: number;
  /** Half-weight applied to a sector's deviation from the market base. */
  sector_damp: number;
  /** Weight on the growth z-score, in the exponent: exp(beta * z). */
  momentum_beta: number;
  /** Momentum divisor (percentage points) inside the tanh. */
  momentum_divisor: number;
  /** Winsor bounds for the seven-day change, in per cent. */
  momentum_clip_low: number;
  momentum_clip_high: number;
  /** Track-record floor and range on the log-age curve. */
  record_floor: number;
  record_range: number;
  /** Days at which the log-age curve reaches its top. */
  record_days: number;
  /** Reach step on the log-chains curve. */
  reach_step: number;
  /** Chains at which the reach curve reaches its top. */
  reach_chains: number;
}

export const SPEC: ModelSpec = {
  scale_exponent: -0.5,
  sector_prior: 60,
  sector_min_live: 3,
  sector_damp: 0.5,
  momentum_beta: 0.2,
  momentum_divisor: 26,
  momentum_clip_low: -60,
  momentum_clip_high: 120,
  record_floor: 0.9,
  record_range: 0.2,
  record_days: 1460,
  reach_step: 0.1,
  reach_chains: 9,
};

/** The model's version label, shown on the dashboard. */
export const MODEL_VERSION = 'radar-5';

/** How many live-token protocols the "already trading" table carries. */
export const LIVE_ROWS = 24;

/** What the snapshot calibrates at run time: the numbers the dashboard quotes. */
export interface Calibration {
  /** Median market-cap/TVL of live protocols (mcap and TVL both positive). */
  base: number;
  /** How many live protocols the base is read off. */
  live_count: number;
  /** Reference TVL for the scale factor: the median live TVL. */
  scale_ref_tvl: number;
  /** Median seven-day change across pre-token protocols that report one. */
  median_change_7d: number;
  /** Median age in days across pre-token protocols that carry a listing date. */
  median_age_days: number;
  /** Per-sector median market-cap/TVL, sectors with enough live protocols only. */
  sector_median: Record<string, number>;
  /** Live protocols counted per sector (for the dashboard's comparables table). */
  sector_live_count: Record<string, number>;
}

/** One farm step: what to do, what it costs, how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  age_days: number | null;
  implied_value_usd: number;
  value_band: string;
  model: {
    base_multiple: number;
    scale_factor: number;
    sector_multiple: number | null;
    sector_factor: number;
    momentum_pct: number;
    momentum_factor: number;
    record_factor: number;
    reach_factor: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** One live-token protocol for the "already trading" table. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  tvl_multiple: number | null;
}

/** One board row, slimmed for the dashboard's data.js. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  implied_value_usd: number;
  value_band: string;
  scale_factor: number;
  sector_factor: number;
  sector_multiple: number | null;
  momentum_factor: number;
  record_factor: number;
  reach_factor: number;
  farm_steps: string[];
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  spec: ModelSpec;
  model_version: string;
  calibration: Calibration;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: RadarRow[];
  live: LiveRow[];
}

const DAY_MS = 86_400_000;

/** The median of a non-empty sorted array (average of the middle two when even). */
function medianOf(sorted: number[]): number {
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Round to four decimals, for numbers the dashboard quotes. */
function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** A whole-day count from `listedAt` to `asOf`, clamped at zero; null when absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** Whether the snapshot records no token at all for this protocol. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** Whether the board may rank this protocol: pre-token, not an exchange, not a versioned pool. */
export function isRankable(p: SnapshotProtocol): boolean {
  return isPreToken(p) && p.category !== 'CEX' && !VERSIONED.test(p.name);
}

/**
 * Read the calibration off the snapshot. The base is the median market-cap/TVL
 * of the protocols whose token trades; the sector medians are the same ratio
 * cut by category. The scale reference is the median live TVL. The median
 * change and median age are read off the pre-token protocols, so the momentum
 * and record curves are centred on the board's own population, not on an
 * absolute zero.
 */
export function calibrate(snapshot: Snapshot): Calibration {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const liveRatios = live.map((p) => p.mcap_usd! / p.tvl_usd).sort((a, b) => a - b);
  const base = liveRatios.length > 0 ? medianOf(liveRatios) : 0.25;
  const liveTvls = live.map((p) => p.tvl_usd).sort((a, b) => a - b);
  const scaleRef = liveTvls.length > 0 ? medianOf(liveTvls) : 32_575_274;

  const bySector = new Map<string, number[]>();
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0 || p.category === null) continue;
    const list = bySector.get(p.category) ?? [];
    list.push(p.mcap_usd / p.tvl_usd);
    bySector.set(p.category, list);
  }
  const sectorMedian: Record<string, number> = {};
  const sectorLiveCount: Record<string, number> = {};
  for (const [sector, ratios] of [...bySector.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    if (ratios.length < SPEC.sector_min_live) continue;
    sectorMedian[sector] = round4(medianOf([...ratios].sort((a, b) => a - b)));
    sectorLiveCount[sector] = ratios.length;
  }

  const changes = snapshot.protocols
    .filter((p) => isPreToken(p) && p.change_7d !== null)
    .map((p) => p.change_7d!)
    .sort((a, b) => a - b);
  const medianChange = changes.length > 0 ? medianOf(changes) : 0;

  const ages = snapshot.protocols
    .filter((p) => isPreToken(p))
    .map((p) => ageDays(snapshot.as_of, p.listed_at))
    .filter((a): a is number => a !== null)
    .sort((a, b) => a - b);
  const medianAge = ages.length > 0 ? medianOf(ages) : 365;

  return {
    base: round4(base),
    live_count: liveRatios.length,
    scale_ref_tvl: Math.round(scaleRef),
    median_change_7d: round4(medianChange),
    median_age_days: Math.round(medianAge),
    sector_median: sectorMedian,
    sector_live_count: sectorLiveCount,
  };
}

/**
 * The scale factor: (TVL / T0)^-0.50. Live tokens show market cap growing
 * like the square root of TVL, so a protocol ten times the reference TVL
 * is priced at about a third of the reference multiple, and one a tenth
 * of it at about three times. Clamped as a guardrail; on this snapshot the
 * factor runs 0.11-2.55, so the clamp never binds here.
 */
export function scaleFactor(tvlUsd: number, cal: Calibration): number {
  const raw = Math.pow(Math.max(tvlUsd, 1) / Math.max(cal.scale_ref_tvl, 1), SPEC.scale_exponent);
  return Math.max(0.05, Math.min(20, raw));
}

/** The sector factor: the sector's median multiple, shrunk toward the market base. */
export function sectorFactor(protocol: SnapshotProtocol, cal: Calibration): { multiple: number | null; factor: number } {
  const med = protocol.category === null ? undefined : cal.sector_median[protocol.category];
  if (med === undefined) return { multiple: null, factor: 1 };
  const n = cal.sector_live_count[protocol.category] ?? 0;
  const shrunk = (n * med + SPEC.sector_prior * cal.base) / (n + SPEC.sector_prior);
  const raw = shrunk / cal.base;
  // Clamped: even a sector whose live median is extreme (one 400x outlier
  // survives the median) may move a price at most twofold, never dominate it.
  // On the sealed snapshot factors run 0.95-1.15, so this changes nothing here.
  const factor = Math.max(0.5, Math.min(2, 1 + SPEC.sector_damp * (raw - 1)));
  return { multiple: med, factor };
}

/**
 * The momentum factor: the week's change against the week's median,
 * winsorised, tanh-bounded, then weighted by 0.2 in the exponent. A
 * protocol that grew 26 points faster than the median earns exp(0.2) ≈
 * 1.22; one that fell that far earns ≈ 0.82. The weight is small on
 * purpose: the live peers show no reliable link between one week's growth
 * and the multiple, so growth is a nudge, never a verdict. A protocol
 * with no reported change is scored at the median, which is exactly
 * neutral here — missing data earns no premium and no penalty.
 */
export function momentumFactor(change7d: number | null, cal: Calibration): { pct: number; factor: number } {
  const pct = change7d ?? cal.median_change_7d;
  const clipped = Math.max(SPEC.momentum_clip_low, Math.min(SPEC.momentum_clip_high, pct));
  const z = Math.tanh((clipped - cal.median_change_7d) / SPEC.momentum_divisor);
  const factor = Math.exp(SPEC.momentum_beta * z);
  return { pct: round4(pct), factor };
}

/**
 * The track-record factor: log age, 0.90-1.10, so the first year is worth
 * more than the fourth. The range is narrow on purpose: the live peers
 * show no reliable link between observed history and the multiple either,
 * so age stays in the model (the brief names it) at a small weight.
 */
export function recordFactor(age: number | null, cal: Calibration): number {
  const days = age ?? cal.median_age_days;
  const frac = Math.min(Math.log(1 + days / 365) / Math.log(1 + SPEC.record_days / 365), 1);
  return SPEC.record_floor + SPEC.record_range * frac;
}

/** The reach factor: log chains, capped, so the second chain matters more than the twentieth. */
export function reachFactor(chainCount: number): number {
  const frac = Math.min(Math.log2(Math.max(chainCount, 1)) / Math.log2(SPEC.reach_chains), 1);
  return 1 + SPEC.reach_step * frac;
}

/** Score one protocol: the implied value and every factor that built it. */
export function score(
  protocol: SnapshotProtocol,
  snapshot: Snapshot,
  cal: Calibration,
): {
  implied: number;
  scaleFactor: number;
  sectorMultiple: number | null;
  sectorFactor: number;
  momentumPct: number;
  momentumFactor: number;
  recordFactor: number;
  reachFactor: number;
  age: number | null;
} {
  const age = ageDays(snapshot.as_of, protocol.listed_at);
  const scale = scaleFactor(protocol.tvl_usd, cal);
  const sector = sectorFactor(protocol, cal);
  const momentum = momentumFactor(protocol.change_7d, cal);
  const record = recordFactor(age, cal);
  const reach = reachFactor(protocol.chains.length);
  const implied = Math.max(
    1,
    Math.round(protocol.tvl_usd * cal.base * scale * sector.factor * momentum.factor * record * reach),
  );
  return {
    implied,
    scaleFactor: scale,
    sectorMultiple: sector.multiple,
    sectorFactor: sector.factor,
    momentumPct: momentum.pct,
    momentumFactor: momentum.factor,
    recordFactor: record,
    reachFactor: reach,
    age,
  };
}

/** The value band from the implied-to-TVL multiple, against the market base. */
export function valueBand(implied: number, tvl: number, base: number): string {
  const ratio = tvl > 0 ? implied / tvl : 0;
  if (ratio >= 1.5 * base) return 'A · richly priced';
  if (ratio >= 1.0 * base) return 'B · fairly priced';
  if (ratio >= 0.6 * base) return 'C · thinly priced';
  return 'D · deeply discounted';
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** The category's opening move, in words a farmer can follow. */
function openMoveFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Put $${capital} of USDC into ${name} as a lender on ${chain} and leave the supply earning for the full hold.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm'))
    return `Put $${capital} of liquidity into the deepest pool on ${name} on ${chain} and keep the position open.`;
  if (c.includes('bridge'))
    return `Move $${capital} of USDC across to ${chain} through ${name}, then put the arrived funds to work in its app.`;
  if (c.includes('staking') || c.includes('restak'))
    return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt token in the wallet.`;
  if (c.includes('perpetual') || c.includes('derivative'))
    return `Post $${capital} of USDC as margin on ${name} and open one small hedged position.`;
  if (c.includes('prediction')) return `Fund ${name} with $${capital} and take one market position.`;
  if (c.includes('curator') || c.includes('allocator'))
    return `Deposit $${capital} into a ${name} vault on ${chain} and hold the vault shares.`;
  if (c.includes('stable'))
    return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain} and hold it.`;
  if (c.includes('rwa'))
    return `Mint $${capital} of the yield-bearing asset ${name} issues on ${chain} and hold it.`;
  if (c.includes('insurance'))
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The weekly habit, specific to the protocol's category: the repeated action that marks steady, on-type use. */
function weeklyHabitFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral'))
    return `Each week, lend a little more and open one small borrow against it, then repay it, so the wallet shows both sides of ${name}.`;
  if (c.includes('dex') || c.includes('yield') || c.includes('leveraged farm'))
    return `Each week, swap a small amount through the deepest pool on ${name}, so the wallet shows trading flow as well as liquidity.`;
  if (c.includes('bridge'))
    return `Each week, bridge a small amount through ${name}, alternating direction when the route allows it.`;
  if (c.includes('staking') || c.includes('restak'))
    return `Each week, restake the rewards ${name} paid out and check the receipt token balance.`;
  if (c.includes('perpetual') || c.includes('derivative'))
    return `Each week, open and close one small hedged position on ${name}, never leaving a large position open.`;
  if (c.includes('prediction'))
    return `Each week, take one small market position on ${name} and settle it before the next one.`;
  if (c.includes('curator') || c.includes('allocator'))
    return `Each week, read ${name}'s vault allocation report and top up a little when it rebalances.`;
  if (c.includes('stable'))
    return `Each week, mint or redeem a small amount of the stable asset through ${name}.`;
  if (c.includes('rwa'))
    return `Each week, check the yield accrual on ${name} and add a little when the asset's price updates.`;
  if (c.includes('insurance'))
    return `Each week, check the cover terms on ${name} and renew a small slice when one lapses.`;
  return `Each week, do one qualifying action — a deposit, a borrow, a swap or a vote — so the wallet shows steady use.`;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time.
 * The plan is derived from the protocol's own record (category, chains, TVL,
 * age), never from a hand-written list of names.
 */
export function plan(p: SnapshotProtocol, age: number | null): FarmStep[] {
  const chain = chainOf(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const open = openMoveFor(p, capital, chain);
  const weekly = weeklyHabitFor(p);
  const gas = capital >= 150 ? 8 : 4;
  return [
    {
      text: `Open one fresh wallet that holds only the funds you plan to farm, and write its seed phrase down on paper, offline.`,
      cost: 'under $3 of gas for the first transaction',
      time: '5 minutes',
    },
    { text: open, cost: `$${capital} of capital and about $${gas} of gas`, time: '15 minutes to set up' },
    { text: weekly, cost: 'about $2 of gas a week', time: '10 minutes a week' },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot.`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
    {
      text: `Open the protocol's own points or rewards page once a week and write down what it shows for your wallet.`,
      cost: 'nothing to check',
      time: '5 minutes a week',
    },
    {
      text: `Farm by hand, one wallet per protocol: scripts and Sybil clusters are the fastest way to be filtered out.`,
      cost: 'nothing',
      time: 'no extra time',
    },
    {
      text: `When you unwind, withdraw in stages and claim only from the link the protocol itself publishes; never pay anyone to claim for you.`,
      cost: 'about $4 of gas to exit',
      time: '20 minutes',
    },
  ];
}

/** One step as a single string: the action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The live-token protocols, by market cap, for the dashboard's trading table. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      tvl_multiple: p.tvl_usd > 0 && p.mcap_usd !== null ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(snapshot: Snapshot, cal: Calibration = calibrate(snapshot)): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug on it, even one the snapshot no longer carries.
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: every rankable pre-token protocol below the watchlist floor.
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p) && p.tvl_usd < snapshot.floor_usd) chosen.set(p.slug, p);
  }
  const scored = [...chosen.values()].map((p) => ({ p, s: score(p, snapshot, cal) }));
  scored.sort(
    (a, b) => b.s.implied - a.s.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0),
  );
  return scored.map((row, i) => ({
    rank: i + 1,
    slug: row.p.slug,
    name: row.p.name,
    category: row.p.category,
    chains: row.p.chains,
    tvl_usd: row.p.tvl_usd,
    change_7d: row.p.change_7d,
    mcap_usd: row.p.mcap_usd,
    listed_at: row.p.listed_at,
    gecko_id: row.p.gecko_id,
    symbol: row.p.symbol,
    token_status: 'pre-token' as const,
    age_days: row.s.age,
    implied_value_usd: row.s.implied,
    value_band: valueBand(row.s.implied, row.p.tvl_usd, cal.base),
    model: {
      base_multiple: cal.base,
      scale_factor: round4(row.s.scaleFactor),
      sector_multiple: row.s.sectorMultiple,
      sector_factor: round4(row.s.sectorFactor),
      momentum_pct: row.s.momentumPct,
      momentum_factor: round4(row.s.momentumFactor),
      record_factor: round4(row.s.recordFactor),
      reach_factor: round4(row.s.reachFactor),
      age_days: row.s.age,
    },
    farm_steps: plan(row.p, row.s.age).map(stepText),
  }));
}

/** One board row, slimmed for the dashboard's data.js. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    listed_at: row.listed_at,
    age_days: row.age_days,
    implied_value_usd: row.implied_value_usd,
    value_band: row.value_band,
    scale_factor: row.model.scale_factor,
    sector_factor: row.model.sector_factor,
    sector_multiple: row.model.sector_multiple,
    momentum_factor: row.model.momentum_factor,
    record_factor: row.model.record_factor,
    reach_factor: row.model.reach_factor,
    farm_steps: row.farm_steps,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const cal = calibrate(snapshot);
  const board = buildBoard(snapshot, cal);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !snapshot.watchlist.includes(r.slug)).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    spec: SPEC,
    model_version: MODEL_VERSION,
    calibration: cal,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    rows: board.map(radarRow),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new Error('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new Error('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new Error('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new Error('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new Error('snapshot.json has no watchlist of slugs');
  }
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new Error(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null when it passes every check. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  if (board.length < 100) return `the board holds ${board.length} rows, under the 100 minimum`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** The dashboard's whole dataset as one script: no fetch, no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
