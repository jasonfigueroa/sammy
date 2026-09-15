## Current Baseline

The trustworthy modern-browser legacy baseline is:

- 380 passing
- 0 failing
- 4 pending

This baseline was established in Chrome 152 using a server topology equivalent
to Sammy's original `test/test_server`.

## Post-Baseline Characterization Suite

Issue #8 adds seven focused tests without changing the production source. They
cover ordinary restart, identical-route definition order, parameter precedence
and caller mutation, shallow `EventContext.params` copying, async callback
timing, and the jQuery collection boundary exposed by application and event
contexts.

The augmented suite contains 387 passing tests, zero failures, four pending
tests, and 391 unique Test objects. These counts describe the current suite;
they do not replace the untouched 380/0/4 legacy baseline above. The modern
harness continues to reject duplicate execution, runner re-entry, page errors,
and failed required resources. Two consecutive headless runs in
Chrome 152.0.7977.75 completed with this result and exit code 0.

## Initial Test Run — Incorrect Serving Topology

Environment:
- Browser: Google Chrome 151.0.7922.174 (Official Build, 64-bit)
- OS: Windows
- Sammy source: unchanged from upstream
- Legacy test runner: bundled Mocha browser runner

Result:
- 287 passing
- 41 failing
- ~87% passing

### Test runner observation

Failed tests may appear twice in the HTML output.

Investigation showed that the vendored Mocha HTML reporter can render an uncaught
failure twice because both the reporter and `Runner.uncaught()` emit `test end`,
causing the reporter to render the same Test object twice.

This does not appear to indicate duplicate test definitions.

## Legacy Test Failure Classification

> **Historical investigation note:** The observations in this section were
> collected while the suite was being served beneath `/test/`, which was later
> determined to be an invalid topology for the legacy test suite. These findings
> remain useful for understanding the behavior of the vendored Mocha runner under
> failure conditions, but they should not be interpreted as Sammy compatibility
> defects.

### Failure Inventory

Mocha reports:                               41 failure events
HTML reporter renders:                       42 failure elements
Unique rendered suite/test/error signatures: 37

The legacy Mocha runner reports 287 passes and 41 failure events. Its HTML reporter renders 42 failure elements. Extraction yields 37 unique suite/test/error signatures. Investigation shows that some asynchronous tests generate multiple failure events, while at least one additional DOM entry is caused by duplicate rendering in the legacy reporter. Therefore, the runner's reported failure count should not be treated as a count of distinct failing test definitions.

## Serving Topology Reassessment

### Historical topology

`test/test_server` configures `test/` as Sinatra's public folder, serves
`test/index.html` at `/`, and remaps `/lib/...` and `/vendor/...` to the
corresponding repository directories. Consequently, specs are available at
root paths and `/fixtures/...` resolves to `test/fixtures/...`. The browser is
expected to start at `http://localhost:<port>/#/`.

Running the original server was not practical in the current environment:
Ruby and Bundler are unavailable, and the lockfile pins Sinatra 1.1.0, Rack
1.2.1, and Vegas 0.1.8. A temporary Python server reproduced the same static
mapping without changing Sammy, the specs, or vendored dependencies.

### Initial ad-hoc `/test/` run

The earlier Chrome 151 run loaded the suite beneath `/test/` and reported 287
passing tests, 41 Mocha fail events, and 42 rendered failure elements. History
tests later changed the pathname to `/`, after which fixture URLs resolved as
`/fixtures/...` against a repository-root server and returned 404. Subsequent
timeouts and uncaught errors caused overlapping Mocha control flow and HTML
reporter corruption. These observations remain useful evidence, but the counts
are not an authoritative compatibility baseline.

### Historically accurate root-served runs

Environment and directly observed results:

- Browser: Chrome 152.0.7977.83, fresh context for every run.
- Final recorded URL: `http://localhost:8767/#/` (temporary port).
- Server: temporary Python mapping equivalent to `test/test_server`.
- First run: 379 passing, one Mocha failure and one rendered failure; Mocha
  completed normally. The failure was a two-second timeout in `Meld renders
  templates correctly`.
- Subsequent confirmation runs: 380 passing, zero Mocha failures, zero
  rendered failures, and four pending tests in each run. They completed
  normally; the final recorded run observed 384 Test objects.
- No started test body ran more than once per `test begin`, and no started test
  emitted excess `test end` events.
- The final server log contained four auxiliary 404 responses: one
  `GET /favicon.ico` and three document requests (`POST /`, `POST /?`, and
  `POST /`). The historical Sinatra app also has no POST route. These requests
  are observed and provisionally tolerated auxiliary traffic; their exact
  source has not been established. There were no failed required browser
  requests, uncaught exceptions, reporter crashes, or duplicate failure
  elements.
- That diagnostic run's server log contained 47 `/fixtures/...` responses,
  all with HTTP 200, including responses observed after history tests visited
  `/testing`, `/push`, `/pop`, and `/`.

### Modern orchestration verification

The Node/Puppeteer harness records two differently scoped fixture metrics. A
final Node 24 verification recorded 49 successful `/fixtures/...` responses
across the server and 34 fixture requests from the primary test page after its
first non-root pathname was observed. The earlier value of 47 was the total
from a separate historical-topology diagnostic run, not the denominator for
the harness's 34-request counter. The instrumentation does not establish why
the server-wide total differed by two requests between those runs.

### Interpretation and uncertainty

It is a strong inference that the incorrect `/test/` topology caused nearly
all of the earlier 41-event failure cascade and the associated runner/reporter
corruption. The repeated clean result is a trustworthy modern-browser legacy
baseline of 380 passing and zero failing, with four pending tests. The isolated 
Meld timeout should remain noted as possible timing flakiness. Chrome also 
updated from version 151 to 152 between experiments, so the exact contribution 
of the browser-version change has not been isolated.
