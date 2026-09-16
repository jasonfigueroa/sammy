import { randomUUID } from 'node:crypto';
import process from 'node:process';
import puppeteer from 'puppeteer';
import {
  ADMISSION_COOKIE,
  MAIN_PAGE_TOKEN,
  VERIFY_ISOLATION,
  installAuxiliaryWindowIsolation
} from './auxiliary-window-isolation.mjs';
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
const RUNNER_ISOLATION_PATH = '/__sammy_runner_isolation';

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

function runnerIsolationEvents(requests, origin) {
  return requests.flatMap((request) => {
    const url = new URL(request.url, origin);
    if (url.pathname !== RUNNER_ISOLATION_PATH) return [];

    return [{
      admitted: url.searchParams.get('admitted') === 'true',
      documentId: url.searchParams.get('document'),
      event: url.searchParams.get('event'),
      href: url.searchParams.get('href'),
      name: url.searchParams.get('name')
    }];
  });
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
  if (state.isolationBodyChecks.checks !== counts.bodyRuns) {
    failures.push(`expected ${counts.bodyRuns} isolation body checks, observed ${state.isolationBodyChecks.checks}`);
  }
  if (state.isolationBodyChecks.failures.length) {
    failures.push(`${state.isolationBodyChecks.failures.length} test body isolation check(s) failed`);
  }

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
  const isolationFailures = [];
  const isolationEvents = [];
  const pendingAuxiliaryClosures = new Set();
  const auxiliaryClosures = new WeakMap();
  const pageIds = new WeakMap();
  const pageErrors = [];
  const visitedPaths = [];
  const admissionMarker = randomUUID();
  let barrierSequence = 0;
  let observedNonRootPath = false;
  let fixturesAfterHistory = 0;
  let nextPageId = 1;
  let browser;
  let context;
  let mainTarget;
  let page;
  let phase = 'starting server';
  let server;
  let harnessFailure = null;

  function pageId(target) {
    if (!pageIds.has(target)) {
      pageIds.set(target, `auxiliary-${nextPageId++}`);
    }
    return pageIds.get(target);
  }

  function recordIsolation(type, details = {}) {
    isolationEvents.push({
      sequence: isolationEvents.length + 1,
      timestamp: Date.now(),
      type,
      ...details
    });
  }

  async function verifyMainPageIdentity() {
    if (!page || page.isClosed()) {
      throw new Error('designated main page is closed or unavailable');
    }
    if (!context || page.browserContext() !== context) {
      throw new Error('designated main page left its original browser context');
    }

    const pages = await context.pages();
    if (!pages.includes(page)) {
      throw new Error('designated main page is absent from its browser context');
    }

    const tokenMatches = await page.evaluate((propertyName, expectedToken) =>
      window[propertyName] === expectedToken,
    MAIN_PAGE_TOKEN, admissionMarker);
    if (!tokenMatches) {
      throw new Error('designated main page token is missing or changed');
    }

    recordIsolation('main-identity-verified', { pageId: 'main' });
  }

  function scheduleAuxiliaryClose(target, source) {
    if (target === mainTarget) return null;
    if (auxiliaryClosures.has(target)) return auxiliaryClosures.get(target);

    const id = pageId(target);
    recordIsolation('auxiliary-page-created', { pageId: id, source, url: target.url() });

    let closure;
    closure = (async () => {
      recordIsolation('auxiliary-close-start', { pageId: id });
      const auxiliaryPage = await target.page();
      if (auxiliaryPage === page) {
        throw new Error('auxiliary cleanup selected the designated main page');
      }
      if (auxiliaryPage && !auxiliaryPage.isClosed()) {
        await auxiliaryPage.close();
      }
      recordIsolation('auxiliary-close-complete', { pageId: id });
    })().catch((error) => {
      isolationFailures.push(`failed to close ${id}: ${error.message}`);
      recordIsolation('auxiliary-close-failed', { error: error.message, pageId: id });
    }).finally(() => {
      pendingAuxiliaryClosures.delete(closure);
    });

    auxiliaryClosures.set(target, closure);
    pendingAuxiliaryClosures.add(closure);
    return closure;
  }

  async function drainAuxiliaryPages() {
    while (pendingAuxiliaryClosures.size) {
      await Promise.all([...pendingAuxiliaryClosures]);
    }

    const pages = await context.pages();
    for (const candidate of pages) {
      if (candidate !== page) {
        scheduleAuxiliaryClose(candidate.target(), 'barrier-enumeration');
      }
    }

    while (pendingAuxiliaryClosures.size) {
      await Promise.all([...pendingAuxiliaryClosures]);
    }
  }

  async function verifyIsolationBarrier() {
    const sequence = ++barrierSequence;
    recordIsolation('barrier-entry', { barrier: sequence });
    await verifyMainPageIdentity();
    await drainAuxiliaryPages();

    if (isolationFailures.length) {
      throw new Error(isolationFailures[0]);
    }

    let pages = await context.pages();
    if (pages.length !== 1 || pages[0] !== page) {
      throw new Error(`expected only the designated main page, observed ${pages.length} pages`);
    }

    await page.bringToFront();
    await verifyMainPageIdentity();
    await drainAuxiliaryPages();
    pages = await context.pages();
    if (pages.length !== 1 || pages[0] !== page) {
      throw new Error(`auxiliary page survived barrier ${sequence}`);
    }

    const foreground = await page.evaluate(() => ({
      hasFocus: document.hasFocus(),
      hidden: document.hidden,
      visibilityState: document.visibilityState
    }));
    if (!foreground.hasFocus || foreground.hidden || foreground.visibilityState !== 'visible') {
      throw new Error(`designated main page was not foregrounded after restoration (${foreground.visibilityState}, focus=${foreground.hasFocus})`);
    }

    const result = {
      barrier: sequence,
      hasFocus: foreground.hasFocus,
      mainVerified: true,
      pageCount: pages.length,
      visibilityState: foreground.visibilityState
    };
    recordIsolation('barrier-exit', result);
    return result;
  }

  try {
    server = await startRootTestServer();
    phase = 'launching browser';
    browser = await puppeteer.launch({ headless: !headed });
    phase = 'creating browser context';
    context = await browser.createBrowserContext();
    phase = 'establishing runner admission';
    await context.setCookie({
      domain: '127.0.0.1',
      name: ADMISSION_COOKIE,
      path: '/',
      value: admissionMarker
    });
    phase = 'creating browser page';
    page = await context.newPage();
    mainTarget = page.target();
    pageIds.set(mainTarget, 'main');
    recordIsolation('main-page-created', { pageId: 'main' });

    context.on('targetcreated', (target) => {
      if (target.type() === 'page' && target !== mainTarget) {
        scheduleAuxiliaryClose(target, 'targetcreated');
      }
    });

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

    phase = 'installing main-page identity';
    await page.evaluateOnNewDocument((propertyName, token) => {
      Object.defineProperty(window, propertyName, {
        configurable: false,
        enumerable: false,
        value: token,
        writable: false
      });
    }, MAIN_PAGE_TOKEN, admissionMarker);
    phase = 'installing auxiliary-page isolation';
    await page.exposeFunction(VERIFY_ISOLATION, verifyIsolationBarrier);
    await page.evaluateOnNewDocument(installAuxiliaryWindowIsolation);
    phase = 'installing Mocha observer';
    await page.evaluateOnNewDocument(installMochaObserver);
    const testUrl = `${server.origin}/#/`;
    const startedAt = Date.now();
    phase = 'navigating to the test page';
    await page.goto(testUrl, { waitUntil: 'domcontentloaded' });
    phase = 'waiting for Mocha completion';
    await waitForMochaCompletion(page);

    phase = 'finalizing auxiliary-page isolation';
    await verifyMainPageIdentity();
    await drainAuxiliaryPages();
    await verifyMainPageIdentity();
    await drainAuxiliaryPages();
    const finalPages = await context.pages();
    if (finalPages.length !== 1 || finalPages[0] !== page) {
      isolationFailures.push(`expected only the designated main page at suite end, observed ${finalPages.length} pages`);
    }

    phase = 'validating results';
    const { isolationState, state } = await page.evaluate(() => ({
      isolationState: window.__sammyAuxiliaryIsolationState,
      state: window.__sammyLegacyTestState
    }));
    const { counts, failures } = inspectResults(state, enforceExpectedCounts);
    const isolationBeacons = runnerIsolationEvents(server.requests, server.origin);
    const admissionBeacons = isolationBeacons.filter((event) => event.event === 'admission');
    const admittedDocuments = admissionBeacons.filter((event) => event.admitted);
    const deniedDocuments = admissionBeacons.filter((event) => !event.admitted);
    const runnerStarts = isolationBeacons.filter((event) => event.event === 'runner-start');
    const auxiliaryPagesCreated = isolationEvents.filter((event) =>
      event.type === 'auxiliary-page-created'
    ).length;
    const auxiliaryCloseStarts = isolationEvents.filter((event) =>
      event.type === 'auxiliary-close-start'
    ).length;
    const auxiliaryCloseCompletions = isolationEvents.filter((event) =>
      event.type === 'auxiliary-close-complete'
    ).length;
    const barrierEntries = isolationEvents.filter((event) => event.type === 'barrier-entry').length;
    const barrierExits = isolationEvents.filter((event) => event.type === 'barrier-exit').length;
    const mainIdentityChecks = isolationEvents.filter((event) =>
      event.type === 'main-identity-verified'
    ).length;
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
    if (isolationFailures.length) failures.push(...isolationFailures);
    if (admittedDocuments.length !== 1) {
      failures.push(`expected one admitted test document, observed ${admittedDocuments.length}`);
    }
    if (runnerStarts.length !== 1) {
      failures.push(`expected one runner-start beacon, observed ${runnerStarts.length}`);
    }
    if (runnerStarts.some((event) => !event.admitted)) {
      failures.push('an unadmitted document emitted a runner-start beacon');
    }
    if (admittedDocuments.length === 1 && runnerStarts.length === 1 &&
        admittedDocuments[0].documentId !== runnerStarts[0].documentId) {
      failures.push('runner-start did not originate from the admitted main document');
    }
    if (barrierSequence !== counts.bodyRuns || barrierEntries !== counts.bodyRuns ||
        barrierExits !== counts.bodyRuns) {
      failures.push(`expected ${counts.bodyRuns} completed isolation barriers, observed ${barrierEntries} entries and ${barrierExits} exits`);
    }
    if (!isolationState || isolationState.barrierRuns !== counts.bodyRuns) {
      failures.push(`expected the page to record ${counts.bodyRuns} isolation barriers, observed ${isolationState ? isolationState.barrierRuns : 0}`);
    }
    if (!isolationState || !isolationState.lastBarrier ||
        isolationState.lastBarrier.hasFocus !== true ||
        isolationState.lastBarrier.visibilityState !== 'visible') {
      failures.push('the designated main page did not record successful foreground restoration');
    }
    if (state.isolationBodyChecks.checks !== barrierSequence) {
      failures.push(`expected one successful barrier per body check, observed ${barrierSequence} barriers and ${state.isolationBodyChecks.checks} checks`);
    }
    if (auxiliaryCloseStarts !== auxiliaryPagesCreated ||
        auxiliaryCloseCompletions !== auxiliaryPagesCreated) {
      failures.push(`expected ${auxiliaryPagesCreated} auxiliary page closures, observed ${auxiliaryCloseStarts} starts and ${auxiliaryCloseCompletions} completions`);
    }

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
      runnerIsolation: {
        admittedDocuments: admittedDocuments.length,
        auxiliaryCloseCompletions,
        auxiliaryCloseStarts,
        auxiliaryPagesCreated,
        barrierEntries,
        barrierExits,
        deniedDocuments: deniedDocuments.length,
        finalPageCount: finalPages.length,
        foregroundRestored: Boolean(isolationState && isolationState.lastBarrier &&
          isolationState.lastBarrier.hasFocus === true &&
          isolationState.lastBarrier.visibilityState === 'visible'),
        mainIdentityChecks,
        mainPageStable: finalPages.length === 1 && finalPages[0] === page,
        runnerStarts: runnerStarts.length,
        testBodyChecks: state.isolationBodyChecks.checks
      },
      unexpectedHttpFailures: unexpectedServerErrors.map((request) => requestKey(request.method, request.url)),
      visitedPaths: [...new Set(visitedPaths)]
    };

    if (failures.length) {
      summary.browserConsole = browserConsole.filter((message) =>
        message.type === 'error' || message.type === 'warn'
      );
      summary.runnerIsolation.bodyCheckFailures = state.isolationBodyChecks.failures;
      summary.runnerIsolation.events = isolationEvents;
      summary.runnerIsolation.failures = isolationFailures;
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
            isolationBodyChecks: current.isolationBodyChecks,
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
          isolationEvents,
          isolationFailures,
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
