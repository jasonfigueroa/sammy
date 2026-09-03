# Repository Guidelines

## Modernization Goals

This repository is an incremental modernization of Sammy.js and is being
developed as a software-engineering portfolio project.

The objective is not to rewrite Sammy from scratch or replace its original
design with a modern framework. The goal is to understand the existing
system, establish confidence in its behavior, and modernize it incrementally
while preserving the useful parts of its original design.

## Modernization Principles

- Preserve existing observable behavior unless a change is explicitly
  discussed and intentional.
- Treat the existing source code and tests as evidence of intended behavior.
- Do not perform large rewrites before understanding the existing
  implementation and its behavioral contracts.
- Prefer small, reviewable changes backed by tests.
- Establish a reproducible behavioral baseline before modifying core Sammy
  functionality.
- Add characterization tests where existing behavior is not adequately
  covered.
- Before significant architectural changes, document:
  - current behavior
  - constraints
  - alternatives
  - tradeoffs
  - chosen approach
- Avoid introducing technology solely because it is newer.
- Preserve Sammy's lightweight philosophy where practical.
- Separate tooling modernization from behavioral changes whenever possible.

## AI-Assisted Development

AI may be used to assist investigation, testing, implementation,
documentation, and code review, but understanding the system takes priority
over generating replacement code.

When investigating unfamiliar code:

1. Explain the current behavior and supporting evidence.
2. Identify uncertainties or assumptions.
3. Discuss alternatives and tradeoffs.
4. Propose substantial changes only after the existing behavior is reasonably
   understood.

Avoid large automated rewrites unless explicitly requested.

## Project Structure & Module Organization

Sammy’s core implementation is `lib/sammy.js`; optional integrations live in `lib/plugins/` as `sammy.<plugin>.js`. Generated release bundles are stored under `lib/min/` and should not be edited by hand. Browser-based Mocha specs are in `test/*_spec.js`, with shared HTML and template data in `test/fixtures/`. `test/index.html` is the test runner and declares every loaded source and spec file. Runnable demonstrations belong in `examples/`; third-party browser dependencies are checked into `vendor/`.

## Build, Test, and Development Commands

- `bundle install` installs the Ruby development and test dependencies from `Gemfile`.
- `bundle exec ruby test/test_server` starts the Sinatra/Vegas test server. Open the URL it prints and confirm the Mocha suite passes in a browser.
- `bundle exec rake version` reads and prints the version declared in `lib/sammy.js`.
- `bundle exec rake minify` rebuilds all versioned and `-latest` files under `lib/min/`; it requires the legacy `uglifyjs` executable on `PATH`.
- `bundle exec rake docs DIR=docs` generates API documentation into the requested directory.

There is no npm test or build script in `package.json`.

## Coding Style & Naming Conventions

Match the established JavaScript style: two-space indentation, semicolons, single quotes for ordinary strings, and spaces inside `function() { ... }` blocks as shown nearby. Use `Sammy.<PascalCase>` for public constructors, camelCase for methods and locals, and underscore-prefixed names for private helpers. Name plugins `sammy.<feature>.js`. Keep compatibility with the older browser-oriented syntax already used; do not introduce a transpilation requirement. No automated formatter or linter is configured, so keep changes focused and follow surrounding code.

## Testing Guidelines

Tests use Mocha’s BDD interface and `expect.js`. Add behavior-focused `describe`/`it` cases to the closest `*_spec.js` file. When introducing a new spec file or plugin, add its script tag to `test/index.html`. Put requestable sample data in `test/fixtures/`. Run the complete browser suite before submitting; no coverage threshold is configured.

## Commit & Pull Request Guidelines

Recent history favors short, imperative summaries such as `Improve json detection` or `Fix indent`; release commits use `Pushing version X.Y.Z`. Keep each commit scoped to one logical change and mention the affected behavior. Pull requests should explain the problem and solution, link relevant issues, list browser-test results, and call out compatibility risks. Include screenshots only for changes to examples or rendered behavior. Do not commit regenerated minified bundles unless the change is explicitly preparing a release.
