# Test Infrastructure Modernization Investigation

This document evaluates the next tooling step. It is not an architecture
decision and does not authorize dependency installation or test migration.

## Established Facts

- The authoritative Chrome 152 baseline is 380 passing, 0 failing, and 4
  pending from a fresh browser context. Production source is unchanged.
- Correct behavior depends on the historical root topology: `/` serves
  `test/index.html`; test specs and `/fixtures/` come from `test/`; and
  `/lib/` and `/vendor/` come from their repository directories.
- `test/index.html` loads every dependency, production file, plugin, and spec
  through ordered script tags. There is no generated bundle or test discovery.
- The page uses browser Mocha 1.0.1, expect.js 0.1.2, jQuery 1.7.2, helper
  extensions, and Mocha's HTML reporter. Four conditional tests are declared
  pending in modern browsers.
- `package.json` contains package metadata only. The Rakefile has version,
  minification, release, and documentation tasks, but no test task or CI.
- The Ruby server is coupled to Sinatra 1.1.0, Rack 1.2.1, and Vegas 0.1.8.
  Its valuable behavior is the URL and MIME mapping, not the obsolete runtime.

See `docs/archaeology.md` for the experiments supporting the baseline.

## Current Responsibility Map

| Concern | Current provider |
| --- | --- |
| HTTP serving | Sinatra exposes `test/` as the root and remaps `/lib/` and `/vendor/`; Rack supplies custom fixture MIME types. |
| Browser automation | None; a developer opens `http://localhost:<port>/#/` manually. |
| Test runner | Vendored browser Mocha 1.0.1 using the BDD interface and serial execution. |
| Assertions | Vendored expect.js 0.1.2 plus `vendor/mocha/helpers.js`. |
| Discovery/loading | Ten spec files and selected plugins are listed explicitly in `test/index.html`. |
| Fixtures | Relative requests such as `fixtures/file.template`; correct pathname semantics are required throughout history tests. |
| Reporting | Mocha's in-page HTML reporter; no stable machine-readable result. |
| Local command | `bundle exec ruby test/test_server`, followed by manual browser use. |
| CI suitability | None configured; completion, exit status, browser version, and request failures are not automated. |

## Options and Tradeoffs

### A. Preserve the suite; add modern orchestration

Add a small server that reproduces the Sinatra mappings and a browser driver
that opens one fresh context, observes actual Mocha runner events, and exits
from the resulting counts. Keep the legacy page, runner, assertions, ordered
scripts, specs, fixtures, and production files otherwise unchanged.

- **Effort / semantic risk:** Low to moderate / low. The whole legacy suite
  must remain in one browser context and retain its current order and timing.
- **Baseline / topology:** Best chance of reproducing 380/0/4 because both are
  explicit acceptance checks and the server owns the exact mappings and MIME
  types.
- **Developer and CI use:** One command can start the server, launch a pinned
  browser, print counts and diagnostics, and return a meaningful exit code.
- **Footprint / test edits:** A Node runtime, one browser-automation package,
  and its browser binary; no spec edits. A narrow harness bridge may be needed
  to expose runner events without relying on reporter DOM.
- **Reversibility:** High; the wrapper can be removed without touching Sammy
  behavior or the test corpus.
- **Advantages:** Fastest reproducible workflow, clean separation of concerns,
  and an immediate path to CI. **Disadvantages:** Retains Mocha 1.0.1 defects,
  its old assertions, explicit loading, and a monolithic browser run.

### B. Upgrade browser Mocha while retaining the specs

Serve a maintained Mocha browser build from managed dependencies, retain the
BDD specs and expect.js initially, and adapt only the harness and verified
incompatibilities. Modern Mocha still supports browser setup and `mocha.run()`,
but its async, uncaught-error, pending, leak, and reporter behavior must be
treated as changed until demonstrated otherwise.

- **Effort / semantic risk:** Moderate / moderate to high.
- **Baseline / topology:** The same server can preserve topology, but 380/0/4
  is a migration target rather than a direct execution of the known runner.
- **Developer and CI use:** Better maintained runner APIs and reporting, but a
  separate browser launcher is still required for automation.
- **Footprint / test edits:** Modern Mocha plus browser automation; bootstrap,
  helper, and possibly individual async tests may need focused edits.
- **Reversibility:** Good if introduced as a parallel harness before removing
  vendored Mocha.
- **Advantages:** Removes the known reporter/uncaught-failure weakness.
  **Disadvantages:** Combines runner and orchestration changes, making count or
  timing differences harder to attribute.

### C. Migrate tests to a browser-first modern runner

Translate the legacy cases into Playwright Test (or a comparable maintained
browser stack), using its server lifecycle, assertions, isolation, reporting,
and CI support. Wrapping the entire unchanged page as one test is Option A,
not a native migration.

- **Effort / semantic risk:** High / high. Per-test fresh contexts, parallelism,
  auto-waiting, hooks, timeouts, and assertion semantics differ from this
  ordered, shared-page suite.
- **Baseline / topology:** Custom serving can preserve URLs, but mapping 384
  legacy test objects and four conditional pending cases requires deliberate
  migration evidence.
- **Developer and CI use:** Excellent filtering, diagnostics, artifacts, and
  cross-browser automation once migration is mature.
- **Footprint / test edits:** A modern runner and browser binaries; extensive
  spec and harness edits, although production source can remain untouched.
- **Reversibility:** Low unless the legacy suite runs in parallel throughout.
- **Advantages:** Strong long-term workflow. **Disadvantages:** Prematurely
  rewrites behavioral evidence and can make a green result mean something new.

## Recommendation

Start with Option A: legacy tests plus modern orchestration. Implement an exact
root-topology server and run the existing page once, serially, in a fresh
browser context. Capture runner pass, fail, pending, begin, and end events;
page errors; failed requests; HTTP status by path; browser version; final URL;
and normal completion. Do not infer success from the HTML reporter alone.

If approved, the first change would likely touch `package.json`, a selected
package-manager lockfile, a browser-runner configuration, new files under
`test/support/`, and this document. A later, separate change could add
`.github/workflows/`. `lib/`, existing `test/*_spec.js`, fixtures, and vendored
libraries should remain untouched. Whether the result bridge belongs in a
small new harness script or a minimal `test/index.html` hook remains open.

Proof requires at least two clean runs reporting exactly 380 pass events, zero
fail events, four pending events, and one end per begun test; all fixture
requests must succeed after pathname changes. The command must fail on count
drift, uncaught exceptions, failed browser requests, reporter crashes, or
abnormal completion. A clean source diff confirms the wrapper did not alter
Sammy or its specs.

## Decisions Not Yet Made

No package manager, automation package, browser provisioning policy, result
bridge, CI operating system, or browser matrix has been selected. Upgrading
Mocha, expect.js, jQuery, or individual specs is deliberately deferred until
the wrapper independently reproduces the baseline.
