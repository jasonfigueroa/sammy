## Initial test baseline

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

Initial investigation indicates this is likely a bug/behavior in the
vendored Mocha HTML reporter. For uncaught failures, both the HTML
reporter and Runner.uncaught() emit `test end`, causing the reporter
to render the same Test object twice.

This does not appear to indicate duplicate test definitions.

## Legacy Test Failure Classification

### Failure Inventory

Mocha reports:                   41 failure events
HTML reporter renders:           42 failure elements
Unique suite/test/error combos:  37

The legacy Mocha runner reports 287 passes and 41 failure events. Its HTML reporter renders 42 failure elements. Extraction yields 37 unique suite/test/error signatures. Investigation shows that some asynchronous tests generate multiple failure events, while at least one additional DOM entry is caused by duplicate rendering in the legacy reporter. Therefore, the runner's reported failure count should not be treated as a count of distinct failing test definitions.

### Root-Cause Clusters

...

### Open Questions

...
