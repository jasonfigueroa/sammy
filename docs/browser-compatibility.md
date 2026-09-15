# Browser Compatibility Policy

## Scope

This document records the evidence used to choose Sammy's browser compatibility
target and the resulting bounded policy for the modernization. It
does not claim that every targeted browser currently passes Sammy's suite.
Cross-browser automation and compatibility fixes are follow-up work.

Three terms are kept separate throughout:

- **Target support** is the compatibility boundary that future changes promise
  to preserve. It is a policy, not proof of current behavior.
- **Automated verification** is a browser and platform combination that runs
  the authoritative suite and can gate a change.
- **Observed compatibility** is a successful, recorded run in a named browser
  version. A one-time observation is weaker than continuing automation.

Statements labeled **Observed** come from repository source, metadata, tests,
or a recorded run. **Inferred** identifies a conclusion drawn from that
evidence.

## Decision Status

The bounded evergreen desktop policy documented below was accepted in
[`ADR 0001`](decisions/0001-browser-support-policy.md). This document preserves
the detailed evidence, alternatives, and limitations supporting that decision.

## Legacy Compatibility Evidence

Sammy's surviving metadata declares jQuery `>=1.4.1`, and its history contains
fixes for browsers and APIs that were current during the 0.6 and 0.7 releases.
Examples include Internet Explorer behavior, Firefox Web Storage differences,
hash-change fallbacks, and HTML5 History support. Core still contains feature
branches for `pushState`, native `hashchange`, and polling. **Observed:**
[`README.md`](../README.md#L7-L60),
[`bower.json`](../bower.json#L20-L25),
[`HISTORY.md`](../HISTORY.md#L202-L203), and
[`lib/sammy.js`](../lib/sammy.js#L238-L326).

These references show historical intent, not a maintained compatibility
contract. The repository does not contain a versioned browser matrix, a
Browserslist configuration, a transpilation target, or continuing runs against
those legacy browsers. The historical jQuery declaration also is not a uniform
source-derived floor: core's conditional `.delegate()` path requires jQuery
1.4.2-era APIs, while the optional `PushLocationProxy` requires jQuery 1.7-era
`.on()` and `.off()`. **Observed:**
[`docs/jquery-dependency-inventory.md`](jquery-dependency-inventory.md#source-implied-api-floors).

**Inferred:** retaining historical browser references as the modernization's
support target would promise behavior that is neither reproducibly testable nor
fully described by the current dependency metadata.

## Current Testable Environment

The authoritative local command is `npm test`. It uses Node 24.20.0,
Puppeteer 25.10.0, and its provisioned Chrome for Testing 152.0.7977.75 in a
fresh browser context. The current suite records 387 passing, 0 failing, 4
pending, and 391 unique Mocha `Test` objects. The untouched legacy baseline
before characterization tests remains 380 passing, 0 failing, and 4 pending.
**Observed:**
[`package.json`](../package.json),
[`test/support/run-legacy-suite.mjs`](../test/support/run-legacy-suite.mjs), and
[`docs/test-infrastructure-modernization.md`](test-infrastructure-modernization.md#approved-direction-and-proposed-tools).

The runner loads vendored jQuery 1.7.2, Mocha 1.0.1, expect.js, core Sammy, and
19 of the 26 first-party plugins in explicit order. Chrome is the only browser
currently automated. No Firefox, Edge, Safari, mobile-browser, or other
platform result is recorded as part of the authoritative harness. **Observed:**
[`test/index.html`](../test/index.html#L8-L92) and
[`docs/jquery-dependency-inventory.md`](jquery-dependency-inventory.md#plugin-dependency-matrix).

Chrome for Testing is intentionally versioned rather than auto-updating. Google
describes this as a way to make automated results deterministic and
reproducible. The pin is therefore valuable baseline evidence, but it must be
refreshed deliberately if it is to remain inside a moving support window.
[Chrome for Testing](https://developer.chrome.com/docs/automation-and-testing/chrome-for-testing/)

## Current Browser Release Policies

The following facts are time-sensitive and were checked on 2026-09-15 against
browser-vendor documentation:

- Chrome Stable moved to a two-week major-release cycle with Chrome 153.
  Chrome Extended Stable receives major updates every eight weeks.
  [Chrome release-cycle announcement](https://developer.chrome.com/blog/chrome-two-week-start)
- Edge Stable also uses a two-week major cycle beginning with version 152.
  Microsoft provides assisted support for the current and two previous Stable
  releases. Extended Stable uses an eight-week cycle, with the current and one
  previous release receiving assisted support; only the current release in
  each channel receives servicing.
  [Microsoft Edge lifecycle](https://learn.microsoft.com/en-us/deployedge/microsoft-edge-support-lifecycle)
- Firefox Rapid Release uses a two-week major cycle. ESR receives a new major
  release about annually, security point releases at least every two weeks,
  and at least a 12-week overlap between ESR generations.
  [Firefox channels](https://support.mozilla.org/en-US/kb/choosing-firefox-update-channel) and
  [Firefox ESR cycle](https://support.mozilla.org/en-US/kb/firefox-esr-release-cycle)
- Safari is a branded browser on Apple platforms and is built on WebKit.
  Apple's current release notes identify Safari 26.6 as stable and Safari 27 as
  beta. A generic WebKit automation result is useful early-warning evidence,
  but it is not a run in branded Safari. Playwright likewise documents that its
  patched WebKit build is often ahead of Safari and cannot launch branded
  Safari.
  [Safari release notes](https://developer.apple.com/documentation/safari-release-notes) and
  [Playwright browser documentation](https://playwright.dev/docs/browsers#webkit)

jQuery's maintained policy is relevant dependency evidence, not Sammy's policy.
jQuery 4 currently targets recent desktop and mobile browsers and identifies
jQuery 1.x and 2.x as unsupported. Sammy's authoritative suite still uses
jQuery 1.7.2, so adopting an evergreen browser target does not establish
compatibility with maintained jQuery.
[jQuery browser support](https://jquery.com/browser-support/) and
[jQuery version support](https://jquery.com/support/)

## Strategies Considered

| Strategy | Advantages | Costs and risks | Maintenance |
| --- | --- | --- | --- |
| Preserve historical browser claims | Maximizes theoretical continuity with Sammy's original audience. | Browser binaries, operating systems, and the original dependency stack are difficult to obtain safely and reproducibly; historical claims are incomplete and already diverge from source API floors. It would constrain modernization without reliable verification. | High and open-ended. |
| Support only the pinned Chrome baseline | Matches current evidence and has the smallest immediate tooling cost. | Confuses one reproducible browser run with a useful library support policy and provides no independent engine coverage. | Low, but too narrow. |
| Use bounded evergreen desktop windows | Covers the principal current desktop engines and enterprise release channels while permitting native modern syntax and APIs once verified. | Requires cross-browser provisioning, periodic pin updates, and access to Apple hardware for real Safari evidence. | Moderate and explicit. |

**Accepted:** use bounded evergreen desktop windows. This is the smallest policy
that is broader than the current Chrome observation without reviving unsupported
legacy environments.

## Accepted Target Matrix

The windows below move with each vendor's stable releases. Version examples are
not permanent policy.

| Browser family | Target support policy | Currently automated | Periodic/manual verification | Rationale and constraints |
| --- | --- | --- | --- | --- |
| Google Chrome | Current Stable and the two preceding Stable majors; current Extended Stable major. | Chrome for Testing 152.0.7977.75 only. | Branded Stable and Extended Stable; Beta may be advisory. | A three-release Stable window is about six weeks at the current cadence and matches the size of Edge's documented Stable support window. Extended Stable is included separately because its eight-week enterprise cadence can place it outside that Stable window. The automated pin must be refreshed deliberately. |
| Microsoft Edge | Current and two preceding Stable majors; current and one preceding Extended Stable major. | No. | Branded Stable and Extended Stable on Windows. | Chrome and Edge share Chromium/Blink, but they are distinct products with different channels, packaging, and enterprise policies. Every Edge version need not duplicate every Chrome run, but Edge must not be inferred solely from Chrome. |
| Mozilla Firefox | Current and preceding Rapid Release; every Mozilla-supported ESR generation. | No. | Branded Firefox Stable and supported ESR releases. | Stable and ESR serve different audiences. During Mozilla's overlap there may be two supported ESR generations. |
| Apple Safari | Current and immediately preceding stable Safari major available on supported macOS releases. | No. | Real Safari on macOS; WebKit automation may supplement but not replace it. | The target is explicitly desktop-only. Branded Safari cannot be validated by the current Windows harness, and WebKit builds do not prove Safari or macOS integration behavior. |
| Mobile browsers | No target-support claim in this phase. | No. | None required until a later decision. | The current suite is desktop-oriented and has no recorded mobile-browser evidence. Mobile Chrome and iOS Safari require an explicit later scope and verification plan. |
| Internet Explorer, Edge Legacy, and other browsers | Not targeted. | No. | None. | Historical references remain archaeology evidence; they do not create a current support promise. |

### Current evidence status

| Environment | Status under the accepted target | Automated verification | Observed compatibility |
| --- | --- | --- | --- |
| Chrome for Testing 152.0.7977.75 | Inside the accepted Chrome window as of 2026-09-15. | Yes, through `npm test`. | 387 passing, 0 failing, 4 pending, 391 unique tests. |
| Current/previous branded Chrome and current Extended Stable | Targeted. | No. | No repository-backed result recorded. |
| Edge Stable / Extended Stable | Targeted. | No. | No repository-backed result recorded. |
| Firefox Stable / ESR | Targeted. | No. | No repository-backed result recorded. |
| Safari on macOS | Targeted. | No. | No repository-backed result recorded. |
| Playwright WebKit | Supplementary evidence only. | No. | No repository-backed result recorded. |

## Supported Surface

The browser policy needs a bounded code surface as well as version windows:

1. **Core:** `lib/sammy.js` is the primary target-support commitment.
2. **Suite-loaded first-party plugins:** the 19 plugins loaded by
   `test/index.html` are inside the verification surface for the behavior their
   existing tests exercise. Compatibility with every version of an external
   template, analytics, or service dependency is not implied.
3. **Legacy or unverified plugins:** `form_2_json`, `googleanalytics`,
   `kissmetrics`, `mixpanel`, `path_location_proxy`, `push_location_proxy`, and
   `title` are retained but receive no target-support claim until they have
   focused evidence. Their presence in `lib/plugins/` is not certification.

The tiering prevents the browser matrix from silently promising all optional
integrations while preserving them for later evaluation.

## Implementation Consequences

### JavaScript syntax and browser APIs

Until another decision introduces transpilation, polyfills, or multiple
distribution targets, production syntax and browser APIs must execute natively
throughout the accepted browser target. Compatibility-affecting changes should
be checked against the oldest release in each target window. Existing fallback
paths should not be removed merely because the current Chrome run does not use
them.

This policy does not itself authorize a syntax modernization or identify an
ECMAScript edition as the new source style. It defines the constraint for a
later, separately reviewed change.

### jQuery

The browser target does not replace the jQuery compatibility decision. Current
facts remain:

- package-era metadata says `>=1.4.1`;
- source paths imply different minimum APIs;
- the authoritative suite observes jQuery 1.7.2;
- current jQuery support is on a much newer major line.

A jQuery upgrade, replacement, or revised package constraint requires its own
tests and decision. Browser results obtained with jQuery 1.7.2 describe that
combined runtime, not Sammy in isolation.

### Test automation

The existing Chrome harness remains the authoritative regression gate until
cross-browser orchestration is added. Accepting this policy would create a
verification gap, not hide it. Follow-up work should determine which target
boundaries run on every change and which run periodically. Real Safari evidence
requires an Apple-hosted environment; Linux or Windows WebKit automation may be
added as supplementary feedback.

The historical 380/0/4 baseline remains unchanged. New characterization tests
make the current executable expectation 387/0/4 with 391 unique tests in every
environment adopted as a full suite gate, unless a browser-specific pending
policy is separately justified and documented.

## Maintenance Rules

The accepted policy should be maintained as follows:

- Interpret `current` from the vendor's stable channel, not from the browser
  version installed on a contributor's machine.
- Record exact browser versions with every compatibility result.
- Keep pinned automation reproducible, but refresh pins before they leave the
  applicable target window.
- Treat Beta, preview, and WebKit-main runs as advisory unless a later decision
  promotes them to a gate.
- Do not label a browser supported solely because a related engine passes.
- Revisit the matrix when a vendor changes cadence, servicing, platform
  availability, or release-channel policy.

## Risks and Unresolved Questions

- Which browser/platform combinations should gate each pull request, and which
  should run periodically?
- Should Chrome and Edge share a reduced Chromium smoke suite or both run the
  complete legacy page?
- What is the smallest reliable path to real Safari verification for this
  project?
- Should the suite-loaded plugin tier eventually receive the same formal
  support claim as core, or remain conditional on each plugin's external
  dependency?
- Which jQuery version or migration path can satisfy the accepted browser
  target without changing observable Sammy behavior?
- What evidence and maintenance budget would justify adding mobile browsers?
- When the target moves, how should a newly unsupported browser release be
  communicated to downstream users?
