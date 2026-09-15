import process from 'node:process';
import puppeteer from 'puppeteer';
import { installMochaObserver } from './mocha-observer.mjs';
import { startRootTestServer } from './root-test-server.mjs';

// These counts describe the current suite, including post-baseline
// characterization tests. The untouched legacy baseline remains documented in
// docs/archaeology.md.
const EXPECTED = {
  bodyRuns: 387,
  ends: 391,
  fails: 0,
  passes: 387,
  pending: 4,
  starts: 387,
  tests: 391
};
const RUN_TIMEOUT_MS = 60_000;

function countEvents(state, type) {
  return state.events.filter((event) => event.type === type).length;
}

function requestKey(method, rawUrl) {
  return `${method} ${rawUrl}`;
}

function isExpectedAuxiliaryRequest(request) {
  const url = new URL(request.url, 'http://127.0.0.1');
  return (request.method === 'GET' && url.pathname === '/favicon.ico') ||
    (request.method === 'POST' && (request.url === '/' || request.url === '/?'));
}

function isRequiredServerRequest(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return false;
  }

  const pathname = new URL(request.url, 'http://127.0.0.1').pathname;
  return pathname === '/' ||
    pathname.startsWith('/fixtures/') ||
    pathname.startsWith('/lib/') ||
    pathname.startsWith('/vendor/') ||
    /_spec\.js$/.test(pathname);
}

function isRequiredBrowserRequest(request, mainPage) {
  const url = new URL(request.url());
  const pathname = url.pathname;
  let type = null;

  try {
    type = request.resourceType();
  } catch (error) {
    if (error.name !== 'UnsupportedOperation') {
      throw error;
    }
  }

  if (request.isNavigationRequest() && request.frame() === mainPage.mainFrame()) {
    return true;
  }

  return pathname.startsWith('/fixtures/') ||
    pathname.startsWith('/lib/') ||
    pathname.startsWith('/vendor/') ||
    ['fetch', 'script', 'stylesheet', 'xhr'].includes(type);
}

function inspectResults(state, enforceExpectedCounts) {
  const failures = [];
  const tests = Object.values(state.tests);
  const counts = {
    bodyRuns: tests.reduce((sum, test) => sum + test.bodyRuns, 0),
    ends: countEvents(state, 'test end'),
    fails: countEvents(state, 'fail'),
    passes: countEvents(state, 'pass'),
    pending: countEvents(state, 'pending'),
    starts: countEvents(state, 'test'),
    tests: tests.length
  };

  if (enforceExpectedCounts) {
    for (const [name, expected] of Object.entries(EXPECTED)) {
      if (counts[name] !== expected) {
        failures.push(`expected ${expected} ${name}, observed ${counts[name]}`);
      }
    }
  }

  if (!state.attached) failures.push('Mocha observer did not attach');
  if (state.attachmentError) failures.push(`Mocha observer error: ${state.attachmentError.message}`);
  if (!state.completed) failures.push('Mocha did not emit end');
  if (!state.callbackInvoked) failures.push('Mocha completion callback was not invoked');
  if (state.callbackFailures !== 0) failures.push(`Mocha callback reported ${state.callbackFailures} failures`);
  if (state.runnerRuns !== 1) failures.push(`expected one Runner.run(), observed ${state.runnerRuns}`);
  if (countEvents(state, 'start') !== 1) failures.push(`expected one start event, observed ${countEvents(state, 'start')}`);
  if (countEvents(state, 'end') !== 1) failures.push(`expected one end event, observed ${countEvents(state, 'end')}`);

  for (const test of tests) {
    const terminalEvents = test.passes + test.fails + test.pending;
    if (terminalEvents !== 1 || test.ends !== 1) {
      failures.push(`abnormal terminal events for ${test.fullTitle}`);
    }
    if (test.pending === 1 && (test.starts !== 0 || test.bodyRuns !== 0)) {
      failures.push(`pending test executed: ${test.fullTitle}`);
    }
    if (test.pending === 0 && (test.starts !== 1 || test.bodyRuns !== 1)) {
      failures.push(`abnormal execution count for ${test.fullTitle}`);
    }
  }

  return { counts, failures };
}

async function waitForMochaCompletion(page) {
  const deadline = Date.now() + RUN_TIMEOUT_MS;

  while (Date.now() < deadline) {
    const completed = await page.evaluate(() => {
      const state = window.__sammyLegacyTestState;
      return Boolean(state && state.completed && state.callbackInvoked);
    });

    if (completed) {
      return;
    }

    await new Promise((resolveWait) => setTimeout(resolveWait, 50));
  }

  throw new Error(`Mocha did not complete within ${RUN_TIMEOUT_MS}ms`);
}

async function run() {
  const headed = process.argv.includes('--headed');
  const enforceExpectedCounts = !process.argv.includes('--observe-counts');
  const browserConsole = [];
  const failedRequiredRequests = [];
  const pageErrors = [];
  const visitedPaths = [];
  let observedNonRootPath = false;
  let fixturesAfterHistory = 0;
  let browser;
  let context;
  let page;
  let phase = 'starting server';
  let server;
  let harnessFailure = null;

  try {
    server = await startRootTestServer();
    phase = 'launching browser';
    browser = await puppeteer.launch({ headless: !headed });
    phase = 'creating browser context';
    context = await browser.createBrowserContext();
    phase = 'creating browser page';
    page = await context.newPage();

    page.on('console', (message) => {
      browserConsole.push({
        text: message.text(),
        type: message.type()
      });
    });
    page.on('error', (error) => {
      pageErrors.push({ message: error.message, stack: error.stack });
    });
    page.on('pageerror', (error) => {
      pageErrors.push({ message: error.message, stack: error.stack });
    });
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) {
        const url = new URL(frame.url());
        visitedPaths.push(`${url.pathname}${url.hash}`);
        if (url.pathname !== '/') {
          observedNonRootPath = true;
        }
      }
    });
    page.on('request', (request) => {
      if (new URL(request.url()).pathname.startsWith('/fixtures/') && observedNonRootPath) {
        fixturesAfterHistory += 1;
      }
    });
    page.on('requestfailed', (request) => {
      if (isRequiredBrowserRequest(request, page)) {
        failedRequiredRequests.push({
          error: request.failure()?.errorText || 'request failed',
          method: request.method(),
          url: request.url()
        });
      }
    });
    page.on('response', (response) => {
      const request = response.request();
      if (response.status() >= 400 && isRequiredBrowserRequest(request, page)) {
        failedRequiredRequests.push({
          error: `HTTP ${response.status()}`,
          method: request.method(),
          url: request.url()
        });
      }
    });

    phase = 'installing Mocha observer';
    await page.evaluateOnNewDocument(installMochaObserver);
    const testUrl = `${server.origin}/#/`;
    const startedAt = Date.now();
    phase = 'navigating to the test page';
    await page.goto(testUrl, { waitUntil: 'domcontentloaded' });
    phase = 'waiting for Mocha completion';
    await waitForMochaCompletion(page);

    phase = 'validating results';
    const state = await page.evaluate(() => window.__sammyLegacyTestState);
    const { counts, failures } = inspectResults(state, enforceExpectedCounts);
    const auxiliaryRequests = server.requests.filter(isExpectedAuxiliaryRequest);
    const unexpectedServerErrors = server.requests.filter((request) =>
      request.status >= 400 && !isExpectedAuxiliaryRequest(request)
    );
    const failedServerResources = unexpectedServerErrors.filter(isRequiredServerRequest);

    if (pageErrors.length) failures.push(`${pageErrors.length} uncaught page error(s)`);
    if (failedRequiredRequests.length) failures.push(`${failedRequiredRequests.length} required resource failure(s)`);
    if (failedServerResources.length) failures.push(`${failedServerResources.length} required server resource failure(s)`);
    if (!observedNonRootPath) failures.push('no non-root history pathname was observed');
    if (!fixturesAfterHistory) failures.push('no successful fixture request was observed after history pathname changes');

    const requiredFixtureResponses = server.requests.filter((request) =>
      new URL(request.url, server.origin).pathname.startsWith('/fixtures/')
    );
    if (!requiredFixtureResponses.length || requiredFixtureResponses.some((request) => request.status !== 200)) {
      failures.push('fixture response validation failed');
    }

    const summary = {
      auxiliaryHttpFailures: auxiliaryRequests.map((request) => requestKey(request.method, request.url)),
      browser: await browser.version(),
      browserConsoleCount: browserConsole.length,
      countPolicy: enforceExpectedCounts ? 'strict' : 'observed',
      counts,
      durationMs: Date.now() - startedAt,
      failedRequiredRequests,
      failedServerResources: failedServerResources.map((request) => requestKey(request.method, request.url)),
      finalUrl: page.url(),
      fixtureRequests: requiredFixtureResponses.length,
      fixturesAfterHistory,
      mode: headed ? 'headed' : 'headless',
      pageErrors,
      unexpectedHttpFailures: unexpectedServerErrors.map((request) => requestKey(request.method, request.url)),
      visitedPaths: [...new Set(visitedPaths)]
    };

    if (failures.length) {
      summary.browserConsole = browserConsole.filter((message) =>
        message.type === 'error' || message.type === 'warn'
      );
    }

    console.log(JSON.stringify(summary, null, 2));

    if (failures.length) {
      console.error('\nLegacy harness validation failed:');
      failures.forEach((failure) => console.error(`- ${failure}`));
      process.exitCode = 1;
    }
  } catch (error) {
    harnessFailure = error;
    console.error(`Harness failed while ${phase}.`);
    console.error(error.stack || error.message);
    if (page) {
      try {
        const diagnosticState = await page.evaluate(() => {
          const current = window.__sammyLegacyTestState;
          if (!current) return null;
          const tests = Object.values(current.tests);
          const firstFailure = current.events.find((event) => event.type === 'fail');
          return {
            attached: current.attached,
            attachmentError: current.attachmentError,
            counts: {
              bodyRuns: tests.reduce((sum, test) => sum + test.bodyRuns, 0),
              ends: current.events.filter((event) => event.type === 'test end').length,
              fails: current.events.filter((event) => event.type === 'fail').length,
              passes: current.events.filter((event) => event.type === 'pass').length,
              pending: current.events.filter((event) => event.type === 'pending').length,
              starts: current.events.filter((event) => event.type === 'test').length,
              tests: tests.length
            },
            callbackFailures: current.callbackFailures,
            callbackInvoked: current.callbackInvoked,
            completed: current.completed,
            eventCount: current.events.length,
            firstFailure: firstFailure ? {
              ...firstFailure,
              fullTitle: current.tests[firstFailure.testId]?.fullTitle || null
            } : null,
            lastEvents: current.events.slice(-10).map((event) => ({
              error: event.error ? { message: event.error.message } : null,
              fullTitle: current.tests[event.testId]?.fullTitle || null,
              location: event.location,
              sequence: event.sequence,
              testId: event.testId,
              timestamp: event.timestamp,
              type: event.type
            })),
            runnerRuns: current.runnerRuns,
            testCount: Object.keys(current.tests).length
          };
        });
        console.error(JSON.stringify({
          browser: browser ? await browser.version() : null,
          browserConsole: browserConsole.filter((message) =>
            message.type === 'error' || message.type === 'warn'
          ),
          browserConsoleCount: browserConsole.length,
          failedRequiredRequests,
          pageErrors,
          pageUrl: page.url(),
          state: diagnosticState,
          visitedPaths: [...new Set(visitedPaths)]
        }, null, 2));
      } catch (diagnosticError) {
        console.error(`Could not read page diagnostics: ${diagnosticError.message}`);
      }
    }
    if (server) {
      const rootDocuments = server.requests.filter((request) =>
        request.method === 'GET' && new URL(request.url, server.origin).pathname === '/'
      );
      const fixtureRequests = server.requests.filter((request) =>
        new URL(request.url, server.origin).pathname.startsWith('/fixtures/')
      );
      const failedServerRequests = server.requests.filter((request) => request.status >= 400);
      console.error(JSON.stringify({
        serverSummary: {
          failedRequests: failedServerRequests.map((request) =>
            requestKey(request.method, request.url)
          ),
          fixtureRequests: fixtureRequests.length,
          requests: server.requests.length,
          rootDocumentRequests: rootDocuments.length
        }
      }, null, 2));
    }
    process.exitCode = phase === 'navigating to the test page' ||
      phase === 'waiting for Mocha completion' ? 1 : 2;
  } finally {
    const cleanupErrors = [];

    if (context) {
      try {
        await context.close();
      } catch (error) {
        cleanupErrors.push(`browser context: ${error.message}`);
      }
    }
    if (browser) {
      try {
        await browser.close();
      } catch (error) {
        cleanupErrors.push(`browser: ${error.message}`);
      }
    }
    if (server) {
      try {
        await server.stop();
      } catch (error) {
        cleanupErrors.push(`server: ${error.message}`);
      }
    }

    if (cleanupErrors.length) {
      cleanupErrors.forEach((error) => console.error(`Cleanup failed (${error})`));
      process.exitCode = 2;
    } else if (!harnessFailure && process.exitCode === undefined) {
      process.exitCode = 0;
    }
  }
}

await run();
