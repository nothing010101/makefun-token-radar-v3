// Token radar entry, radar-5 (Node 22, standard library only).
//
// Reads the sealed snapshot, scores every pre-token protocol with
// lib/model.ts — the peer-calibrated model: TVL x market base x scale
// x sector x momentum x record x reach — and writes the ranked board, the
// dashboard data, the dashboard, the screenshots and the dossier into the
// output directory. The run is deterministic: the same snapshot always
// writes the same bytes.
//
//   node main.ts --input <snapshot.json|directory> --output <dir>
//
// Without --output, MAKEFUN_OUTPUT_DIR stands in for /output, else /output.
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const here = fileURLToPath(new URL('.', import.meta.url));

/** Caps the sealed scorer enforces on the dossier. */
const TEXT_MAX_BYTES = 65_536;
const SHOT_MAX = 4;
const SHOT_MAX_BYTES = 524_288;
const DASH_MAX_FILES = 400;
const DASH_MAX_BYTES = 4_194_304;
const IMAGE_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

function die(message: string): never {
  process.stderr.write(`radar-5: ${message}\n`);
  process.exit(1);
}

/** Read `--name <value>` or `--name=<value>` from argv, else `fallback`. */
function option(name: string, fallback: string): string {
  const i = process.argv.indexOf(`--${name}`);
  if (i >= 0 && i + 1 < process.argv.length) return process.argv[i + 1]!;
  const joined = process.argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

const inputArg = option('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) die(`no snapshot at ${inputFile}: pass --input <snapshot.json|directory>`);
const outDir = option('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) die(`the model wrote a board the gate refuses: ${issue}`);

/** Copy a directory's regular files into `to`, skipping dot-names. */
function copyDirectory(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const names: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    names.push(name);
  }
  return names;
}

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

const dash = copyDirectory(join(here, 'dashboard'), join(outDir, 'dashboard'));
if (!dash.includes('index.html')) die('dashboard/ holds no index.html');
const shots = copyDirectory(join(here, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) die(`screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3, the board, a detail view and a filtered view`);
for (const name of shots) {
  if (!IMAGE_NAME.test(name)) die(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
}

// The dossier is written last: the scorer rebuilds it from this output and compares bytes.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: { max: SHOT_MAX, max_bytes: SHOT_MAX_BYTES },
    dashboard: { max_files: DASH_MAX_FILES, max_bytes: DASH_MAX_BYTES },
  }),
);

const first = board[0]!;
const last = board[board.length - 1]!;
process.stdout.write(
  `radar-5: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)\n` +
    `radar-5: base ${radar.calibration.base} from ${radar.calibration.live_count} live protocols, scale reference $${radar.calibration.scale_ref_tvl.toLocaleString('en-US')}, median change ${radar.calibration.median_change_7d}%, median age ${radar.calibration.median_age_days}d\n` +
    `radar-5: top row ${first.slug} at $${first.implied_value_usd.toLocaleString('en-US')}, last row ${last.slug} at $${last.implied_value_usd.toLocaleString('en-US')}\n` +
    `radar-5: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ${join(outDir, 'dashboard')} (${dash.length} files), ${join(outDir, 'screenshots')} (${shots.length} images) and ${join(outDir, 'dossier.json')}\n`,
);
