# Test Infrastructure Modernization Investigation

This document evaluates the next tooling step. It is not an architecture
decision and does not authorize dependency installation or test migration.

## Established Facts

- The authoritative Chrome 152 baseline is 380 passing, 0 failing, and 4
  pending from a fresh browser context. Production source is unchanged.
- That 380/0/4 result remains the untouched legacy baseline. The executable
  harness now validates the augmented current suite, including post-baseline
  characterization tests, at 387 passing, 0 failing, 4 pending, and 391 unique
  Test objects.
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

## Approved Direction and Proposed Tools

Option A is approved. The proposed implementation uses npm, a pinned
`puppeteer` development dependency, and Node's built-in HTTP APIs. npm fits the
existing `package.json`, requires no additional package-manager bootstrap on
the current Windows environment, and produces a lockfile suitable for later
`npm ci` use. The initial pins should be Node 24.20.0 LTS, npm 11.19.0, and
`puppeteer` 25.10.0; that Puppeteer release provisions Chrome for Testing
152.0.7977.75, keeping the automated browser in the established Chrome 152
major. Puppeteer is preferred over Playwright for this first step
because the target is one Chrome run rather than a new test framework or a
cross-browser matrix. Puppeteer 25.10.0 determines the compatible Chrome for
Testing revision that it downloads.

| Automation choice | Fit for this phase |
| --- | --- |
| Puppeteer library | **Preferred.** One Chrome-focused dependency, direct preload/evaluation and network/page-error APIs, a package-matched browser, good Windows and CI support, and easy removal. |
| Playwright library | Equally low test-semantic risk and stronger future cross-browser support, but requires a separate browser-install step (or browser package) and adds capability this Chrome-baseline phase does not need. |
| Selenium WebDriver | Mature and portable, with automated driver/browser management, but early-page instrumentation and network/error collection require more harness machinery and browser selection can be less visibly tied to the lockfile. |

For serving, built-in `node:http` is preferable to Express or a generic static
server. Express adds an unnecessary dependency; generic static servers do not
naturally express the split roots, custom MIME rules, traversal checks, and
diagnostic request classification. All three are reversible, but the small
purpose-built server makes the historical topology executable documentation.

The server binds only to `127.0.0.1` on an available port and implements the
historical mappings directly, using no server dependency. It rejects path
traversal, reproduces the custom fixture MIME types, serves GET and HEAD
requests, and preserves the historical server's lack of POST routes.

### Direct Mocha observation

`test/index.html` does not need to change. Before navigation, Puppeteer can
inject an observer that registers the earliest `DOMContentLoaded` listener.
That listener patches the already-loaded `Mocha.Runner.prototype.run` before
jQuery's ready callback invokes `mocha.run()`. It attaches listeners directly
to the actual Runner and records stable Test identities, `test`, `pass`,
`fail`, `pending`, `test end`, `start`, and `end` events. A narrow wrapper of
the legacy Runnable execution method can count actual test-body invocations.
The observer must preserve return values, callback arguments, thrown errors,
and event order; failure to attach before the run is itself a harness failure.

This avoids reporter-DOM scraping and keeps all existing script tags in their
current order. Puppeteer's page-error listener independently detects a
reporter or other uncaught browser exception.

### Request policy

Every request and response is recorded, but not every non-success response
fails the run. These observed requests are provisionally tolerated auxiliary
traffic when they match exactly:

- `GET /favicon.ico`
- document requests using `POST /` or `POST /?`

The historical server naturally returns 404 for these unsupported POSTs, and
they do not prevent a valid 380/0/4 run. Their exact origin has not been
established, so they are not treated as required legacy behavior or attributed
to a specific test.

A network failure or HTTP error is fatal for the main test document, scripts,
stylesheets, XHR/fetch requests, `/fixtures/**`, `/lib/**`, `/vendor/**`, and
other resources required to execute the suite. Unknown non-required failures
are reported as diagnostics and require an explicit classification rather
than silently expanding the allowlist. All fixture responses must succeed,
including at least one requested after a non-root history pathname has been
observed.

### Runtime and result contract

The intended command is `npm test`. It starts the server, launches the pinned
Chrome headlessly in a new browser context, installs the observer, opens
`/#/`, and waits
for one normal Mocha `end`. In a `finally` block it closes the context and
browser and stops the server. It prints the browser version, URL, event counts,
resource diagnostics, and duration. Exit status 0 means a clean baseline;
status 1 means a test, page, resource, count, or completion failure; status 2
means the harness, server, or browser could not start or cleanly shut down.
An optional `--headed` flag should support visual diagnosis; the first
implementation should confirm 380/0/4 once in each mode before headless becomes
the routine default.

Success for the augmented current suite requires all of the following:

- 387 pass events, zero fail events, four pending events, and 391 unique Test
  objects;
- one Runner invocation, one `start`, one `end`, and one terminal event and
  `test end` per Test object;
- 387 non-pending test begins and body invocations, with no duplicate body
  execution or runner re-entry;
- no timeout, uncaught page error, reporter/listener exception, or abnormal
  browser/server termination;
- no failed required resource and successful fixture requests after history
  pathname changes; and
- the browser version, final URL, and provisionally tolerated auxiliary HTTP
  failures are present in the diagnostic summary.

The first implementation is expected to modify `package.json` and this
document and add `.node-version`, `package-lock.json`,
`test/support/root-test-server.mjs`, `test/support/mocha-observer.mjs`, and
`test/support/run-legacy-suite.mjs`. It should not modify `test/index.html`,
existing specs, fixtures, `lib/`, or `vendor/`. CI configuration remains a
separate follow-up after two consecutive clean local runs.

For cross-browser evidence gathering, the diagnostic observation mode
`npm test -- --observe-counts` suppresses only the exact 387/0/4/391
comparison. It still requires a normally completed, structurally valid run
and retains page, request, duplicate-execution, and runner re-entry
diagnostics. This mode is not a replacement for the strict Chrome `npm test`
regression contract.

## Deferred Decisions

Upgrading Mocha, replacing expect.js, upgrading jQuery, changing discovery or
script order, rewriting specs, changing Sammy production code, adding a
cross-browser matrix, and adding CI are deliberately deferred. The initial
diagnostic artifact format and overall harness timeout can be settled during
implementation without changing the behavioral contract.
