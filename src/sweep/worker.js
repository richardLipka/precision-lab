// Runs a precision sweep off the main thread and reports progress.
import { runSweep } from '../engine/sweep.js';

self.onmessage = (e) => {
  try {
    const out = runSweep(e.data, (done, total) => self.postMessage({ type: 'progress', done, total }));
    self.postMessage({ type: 'done', out });
  } catch (err) {
    self.postMessage({
      type: 'error',
      error: { code: err.code, params: err.params, line: err.line, col: err.col, message: err.message },
    });
  }
};
