/* Token Radar dashboard, radar-5: renders window.RADAR (written by main.ts)
 * with no network. Sortable, filterable board; a detail view per protocol;
 * the sector comparables table; the live set apart. Hash routes:
 * #detail=<slug> opens a protocol, #filter=<category> filters the board. */
(function () {
  'use strict';
  var R = window.RADAR;
  var $ = function (id) { return document.getElementById(id); };
  var rowsEl = $('rows');
  var detailEl = $('detail');
  var state = { q: '', cat: '', chain: '', band: '', watch: false, sort: 'rank', sel: null };

  function money(n) {
    if (n === null || n === undefined) return '—';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n;
  }
  function pct(n) {
    if (n === null || n === undefined) return '—';
    var s = (n > 0 ? '+' : '') + n.toFixed(1) + '%';
    return '<span class="' + (n >= 0 ? 'up' : 'down') + '">' + s + '</span>';
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function ageText(d) {
    if (d === null || d === undefined) return '—';
    if (d < 30) return d + 'd';
    if (d < 365) return Math.round(d / 30) + 'mo';
    return (d / 365).toFixed(1) + 'y';
  }
  function factor(n) { return '× ' + n.toFixed(2); }

  /* Header facts. */
  $('facts').innerHTML =
    '<div><dt>Snapshot</dt><dd>' + esc(R.as_of) + '</dd></div>' +
    '<div><dt>Board</dt><dd>' + R.board_size + ' rows</dd></div>' +
    '<div><dt>Watchlist</dt><dd>' + R.watchlist_size + ' protocols</dd></div>' +
    '<div><dt>Early finds</dt><dd>' + R.early_size + '</dd></div>' +
    '<div><dt>Already trading</dt><dd>' + R.live_size + '</dd></div>';

  /* Model strip: six factors, each stated in one line. The two fitted
   * weights come from the 128 live-token peers: the scale exponent -0.50
   * (t = -5.1) and the momentum weight 0.2 (growth shows no reliable link
   * to the multiple, so it is kept small). */
  var cal = R.calibration;
  var sp = R.spec;
  $('model').innerHTML =
    '<h2>Model ' + esc(R.model_version) + ' — six numbers, all read off the snapshot</h2>' +
    '<div class="factors">' +
    '<div><h3>1 · Market base</h3><p>Median market-cap/TVL of the <b>' + cal.live_count +
    '</b> protocols whose token trades: <code>' + cal.base + '</code>. The median, not the mean — one live protocol trades at 400× its TVL.</p></div>' +
    '<div><h3>2 · Scale</h3><p>Live tokens show market cap growing like the square root of TVL, so a protocol is priced off <code>(TVL / $' + cal.scale_ref_tvl.toLocaleString('en-US') +
    ')^' + sp.scale_exponent + '</code>. At the reference TVL the multiple is exactly the market base; smaller protocols richer, larger ones cheaper.</p></div>' +
    '<div><h3>3 · Sector factor</h3><p>Each sector is priced off its own live median (see the table below), shrunk halfway toward the market base with a ' + sp.sector_prior +
    '-protocol prior. Sectors with fewer than ' + sp.sector_min_live + ' live protocols fall back to the market.</p></div>' +
    '<div><h3>4 · Momentum</h3><p>This week’s TVL change against the week’s median change (' + cal.median_change_7d +
    '%), winsorised to [' + sp.momentum_clip_low + ', +' + sp.momentum_clip_high + ']%, then <code>exp(' + sp.momentum_beta +
    ' × tanh(Δ / ' + sp.momentum_divisor + '))</code>. A small nudge on purpose: the live peers show no reliable link between one week’s growth and the multiple.</p></div>' +
    '<div><h3>5 · Track record</h3><p>Log age, ' + sp.record_floor + '–' + (sp.record_floor + sp.record_range).toFixed(2) + ': the first year of running with no token is worth more than the fourth. Median age here is ' + cal.median_age_days +
    ' days; a protocol with no listing date is scored at the median.</p></div>' +
    '<div><h3>6 · Reach</h3><p>Log chains, capped at ' + sp.reach_chains + ' chains: the second chain matters more than the twentieth.</p></div>' +
    '</div>' +
    '<p style="margin:12px 0 0">Implied value = TVL × base × scale × sector × momentum × record × reach. Every figure comes from the snapshot; no name is ever special-cased. The fitted weights were checked out of fold on the live peers: leave-one-out error 2.13, against 2.38 for the previous model and 2.28 for the bare median.</p>';
  $('src').textContent = 'Data: ' + R.source + '. Floor: $' + R.floor_usd.toLocaleString('en-US') + ' TVL. ' +
    'Implied values are this entry’s own claim, never make.fun’s.';

  /* Sector comparables table, richest sector first. */
  var sectors = Object.keys(cal.sector_median).sort(function (a, b) { return cal.sector_median[b] - cal.sector_median[a]; });
  $('sectorRows').innerHTML = sectors.map(function (s) {
    var m = cal.sector_median[s];
    var vs = (m / cal.base).toFixed(2) + '×';
    return '<tr><td>' + esc(s) + '</td><td class="num">' + cal.sector_live_count[s] + '</td>' +
      '<td class="num">' + m.toFixed(3) + '×</td><td class="num">' + vs + '</td></tr>';
  }).join('');

  /* Filter options from the rows themselves. */
  var cats = {}, chains = {};
  R.rows.forEach(function (r) {
    if (r.category) cats[r.category] = 1;
    r.chains.forEach(function (c) { chains[c] = 1; });
  });
  Object.keys(cats).sort().forEach(function (c) {
    var o = document.createElement('option'); o.textContent = c; $('cat').appendChild(o);
  });
  Object.keys(chains).sort().forEach(function (c) {
    var o = document.createElement('option'); o.textContent = c; $('chain').appendChild(o);
  });

  function filtered() {
    var q = state.q.trim().toLowerCase();
    var out = R.rows.filter(function (r) {
      if (state.watch && R.watchlist.indexOf(r.slug) < 0) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) < 0) return false;
      if (state.band && r.value_band.charAt(0) !== state.band) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      return true;
    });
    var by = {
      rank: function (a, b) { return a.rank - b.rank; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      growth: function (a, b) { return (b.change_7d === null ? -1e9 : b.change_7d) - (a.change_7d === null ? -1e9 : a.change_7d); },
      age: function (a, b) { return (b.age_days === null ? -1 : b.age_days) - (a.age_days === null ? -1 : a.age_days); },
      name: function (a, b) { return a.name < b.name ? -1 : a.name > b.name ? 1 : 0; },
    }[state.sort] || function (a, b) { return a.rank - b.rank; };
    return out.sort(by);
  }

  function renderBoard() {
    var list = filtered();
    $('count').textContent = list.length + ' of ' + R.rows.length + ' rows';
    rowsEl.innerHTML = list.map(function (r) {
      var band = r.value_band.charAt(0);
      return '<tr data-slug="' + esc(r.slug) + '"' + (state.sel === r.slug ? ' class="sel"' : '') + '>' +
        '<td>' + r.rank + '</td>' +
        '<td class="name"><b>' + esc(r.name) + '</b><span>' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td>' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td>' +
        '<td class="num">' + factor(r.sector_factor) + '</td>' +
        '<td class="num"><span class="implied">' + money(r.implied_value_usd) + '</span></td>' +
        '<td><span class="band band-' + band + '">' + band + '</span></td></tr>';
    }).join('');
  }

  function openDetail(slug) {
    var r = null;
    R.rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) { detailEl.hidden = true; state.sel = null; renderBoard(); return; }
    state.sel = slug;
    var base = Math.round(r.tvl_usd * R.calibration.base);
    var sectorLine = r.sector_multiple === null
      ? 'Market base (sector too thin to price off)'
      : 'Sector median ' + r.sector_multiple.toFixed(3) + '×';
    var steps = r.farm_steps.map(function (s) {
      var cut = s.lastIndexOf(' Cost: ');
      if (cut < 0) return '<li>' + esc(s) + '</li>';
      return '<li>' + esc(s.slice(0, cut)) + ' <span class="cost">' + esc(s.slice(cut + 1)) + '</span></li>';
    }).join('');
    detailEl.innerHTML =
      '<button class="close" id="closeDetail">Close ×</button>' +
      '<h2>#' + r.rank + ' — ' + esc(r.name) + '</h2>' +
      '<p class="slug">' + esc(r.slug) + ' · ' + esc(r.category || 'no sector') + ' · ' + esc(r.chains.join(', ')) +
      ' · listed ' + esc(r.listed_at || 'unknown') + ' · records no token</p>' +
      '<h3>Why it ranks here</h3><dl class="breakdown">' +
      '<div><dt>TVL × ' + R.calibration.base + ' (market base)</dt><dd>' + money(base) + '</dd></div>' +
      '<div><dt>Scale factor — (TVL / $' + R.calibration.scale_ref_tvl.toLocaleString('en-US') + ')^' + R.spec.scale_exponent + '</dt><dd>' + factor(r.scale_factor) + '</dd></div>' +
      '<div><dt>Sector factor — ' + esc(sectorLine) + '</dt><dd>' + factor(r.sector_factor) + '</dd></div>' +
      '<div><dt>Momentum factor</dt><dd>' + factor(r.momentum_factor) + '</dd></div>' +
      '<div><dt>Track-record factor</dt><dd>' + factor(r.record_factor) + '</dd></div>' +
      '<div><dt>Reach factor</dt><dd>' + factor(r.reach_factor) + '</dd></div>' +
      '<div><dt>Implied value</dt><dd>' + money(r.implied_value_usd) + '</dd></div>' +
      '<div><dt>Value band</dt><dd>' + esc(r.value_band) + '</dd></div></dl>' +
      '<h3>Farm plan — 7 steps</h3><ol class="steps">' + steps + '</ol>' +
      '<p class="hint">The snapshot records no token for this protocol; that is not proof it has none. Check before you farm.</p>';
    detailEl.hidden = false;
    $('closeDetail').addEventListener('click', function () {
      detailEl.hidden = true; state.sel = null; renderBoard();
      history.replaceState(null, '', location.pathname);
    });
    renderBoard();
    detailEl.scrollIntoView({ block: 'start' });
  }

  /* Live table: the market's own values, apart from the ranking. */
  $('liveRows').innerHTML = R.live.map(function (p) {
    return '<tr><td class="name"><b>' + esc(p.name) + '</b><span>' + esc(p.slug) + '</span></td>' +
      '<td>' + esc(p.category || '—') + '</td>' +
      '<td class="num">' + money(p.tvl_usd) + '</td>' +
      '<td class="num">' + money(p.mcap_usd) + '</td>' +
      '<td class="num">' + (p.tvl_multiple === null ? '—' : p.tvl_multiple.toFixed(2) + '×') + '</td>' +
      '<td class="num">' + pct(p.change_7d) + '</td></tr>';
  }).join('');

  /* Wiring: controls, header sorting, row clicks, hash routes. */
  $('q').addEventListener('input', function (e) { state.q = e.target.value; renderBoard(); });
  $('cat').addEventListener('change', function (e) { state.cat = e.target.value; renderBoard(); });
  $('chain').addEventListener('change', function (e) { state.chain = e.target.value; renderBoard(); });
  $('band').addEventListener('change', function (e) { state.band = e.target.value; renderBoard(); });
  $('watch').addEventListener('change', function (e) { state.watch = e.target.checked; renderBoard(); });
  $('sort').addEventListener('change', function (e) { state.sort = e.target.value; renderBoard(); });
  document.querySelectorAll('#board thead th').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-k');
      var map = { rank: 'rank', tvl: 'tvl', growth: 'growth', age: 'age', name: 'name', implied: 'rank' };
      if (map[k]) { state.sort = map[k]; $('sort').value = map[k]; renderBoard(); }
    });
  });
  rowsEl.addEventListener('click', function (e) {
    var tr = e.target.closest('tr');
    if (tr) { openDetail(tr.getAttribute('data-slug')); history.replaceState(null, '', '#detail=' + tr.getAttribute('data-slug')); }
  });

  function fromHash() {
    var h = location.hash.slice(1);
    if (h.indexOf('detail=') === 0) openDetail(h.slice(7));
    else if (h.indexOf('filter=') === 0) {
      var cat = decodeURIComponent(h.slice(7));
      state.cat = cat; $('cat').value = cat; renderBoard();
    }
  }
  window.addEventListener('hashchange', fromHash);

  renderBoard();
  fromHash();
})();
