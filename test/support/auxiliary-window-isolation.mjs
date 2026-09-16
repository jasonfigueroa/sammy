export const ADMISSION_COOKIE = 'sammy_legacy_harness';
export const MAIN_PAGE_TOKEN = '__sammyLegacyHarnessMainToken';
export const VERIFY_ISOLATION = '__sammyVerifyAuxiliaryIsolation';

// Runs in the designated test page before any document script. The hook is
// registered at DOMContentLoaded, after Mocha exposes the BDD globals and
// before jQuery's ready callback starts the suite.
export function installAuxiliaryWindowIsolation() {
  window.__sammyAuxiliaryIsolationState = {
    barrierRuns: 0,
    lastBarrier: null
  };

  document.addEventListener('DOMContentLoaded', function installIsolationHook() {
    if (typeof window.beforeEach !== 'function') {
      throw new Error('Mocha beforeEach was unavailable for auxiliary-page isolation');
    }

    window.beforeEach(function verifyAuxiliaryIsolation(done) {
      var bridge = window.__sammyVerifyAuxiliaryIsolation;

      if (typeof bridge !== 'function') {
        done(new Error('Auxiliary-page isolation bridge was unavailable'));
        return;
      }

      bridge().then(function(result) {
        window.__sammyAuxiliaryIsolationState.barrierRuns += 1;
        window.__sammyAuxiliaryIsolationState.lastBarrier = result;
        done();
      }, done);
    });
  }, { once: true });
}
