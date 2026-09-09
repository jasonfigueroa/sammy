export function installMochaObserver() {
  const state = window.__sammyLegacyTestState = {
    attached: false,
    attachmentError: null,
    callbackFailures: null,
    callbackInvoked: false,
    completed: false,
    events: [],
    nextTestId: 1,
    runnerRuns: 0,
    tests: {}
  };
  const testIds = new WeakMap();

  function serializeError(error) {
    if (!error) {
      return null;
    }

    return {
      message: error.message || String(error),
      stack: error.stack || null,
      uncaught: error.uncaught === true
    };
  }

  function testDetails(test) {
    if (!test) {
      return null;
    }

    let id = testIds.get(test);
    if (!id) {
      id = state.nextTestId++;
      testIds.set(test, id);
      state.tests[id] = {
        bodyRuns: 0,
        ends: 0,
        fails: 0,
        fullTitle: typeof test.fullTitle === 'function' ? test.fullTitle() : test.title,
        passes: 0,
        pending: 0,
        starts: 0
      };
    }

    return { id, record: state.tests[id] };
  }

  function record(type, test, error) {
    const details = testDetails(test);
    state.events.push({
      error: serializeError(error),
      location: window.location.href,
      sequence: state.events.length + 1,
      testId: details ? details.id : null,
      timestamp: Date.now(),
      type
    });

    if (!details) {
      return;
    }

    if (type === 'test') details.record.starts += 1;
    if (type === 'pass') details.record.passes += 1;
    if (type === 'fail') details.record.fails += 1;
    if (type === 'pending') details.record.pending += 1;
    if (type === 'test end') details.record.ends += 1;
  }

  document.addEventListener('DOMContentLoaded', function attachObserver() {
    try {
      const mocha = window.mocha;
      if (!mocha || !mocha.Runner || !mocha.Runnable) {
        throw new Error('Legacy Mocha globals were unavailable before mocha.run()');
      }

      const originalRunnableRun = mocha.Runnable.prototype.run;
      mocha.Runnable.prototype.run = function observedRunnableRun(callback) {
        if (this.type === 'test') {
          const details = testDetails(this);
          details.record.bodyRuns += 1;
        }
        return originalRunnableRun.call(this, callback);
      };

      const originalRunnerRun = mocha.Runner.prototype.run;
      mocha.Runner.prototype.run = function observedRunnerRun(callback) {
        const runner = this;
        state.runnerRuns += 1;

        runner.on('start', function() {
          record('start');
        });
        runner.on('test', function(test) {
          record('test', test);
        });
        runner.on('pass', function(test) {
          record('pass', test);
        });
        runner.on('fail', function(test, error) {
          record('fail', test, error);
        });
        runner.on('pending', function(test) {
          record('pending', test);
        });
        runner.on('test end', function(test) {
          record('test end', test);
        });
        runner.on('end', function() {
          record('end');
          state.completed = true;
        });

        return originalRunnerRun.call(runner, function observedCompletion(failures) {
          state.callbackFailures = failures;
          state.callbackInvoked = true;
          if (callback) {
            callback(failures);
          }
        });
      };

      state.attached = true;
    } catch (error) {
      state.attachmentError = serializeError(error);
    }
  }, { once: true });
}
