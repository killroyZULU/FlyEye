import { writeSync } from 'node:fs';
import {
  fixtureDiagnostic,
  localStalePreflightStages,
  localStaleResourceStages,
} from './fixture-diagnostics.mjs';
const stages = new Set(localStalePreflightStages);
// Synchronous observations only: never inspect an error, result, or provider payload.
// Missing completion means unknown; diagnostic failures cannot change fixture behavior.
export function localStalePreflightDiagnostics({
  enabled = false,
  write = (line) => writeSync(1, line + '\n'),
} = {}) {
  return (stage, event) => {
    if (!enabled || !stages.has(stage) || (event !== 'enter' && event !== 'passed')) return;
    try {
      write(fixtureDiagnostic('FEAT-003', stage, event));
    } catch {
      // Best-effort diagnostics do not authorize, skip, retry, or replace an operation.
    }
  };
}

const resourceStages = new Set(localStaleResourceStages);
// Cursor only; no inputs/results/errors retained. A failure says where, never why.
export function localStaleResourceDiagnostics({
  enabled = false,
  write = (line) => writeSync(1, line + '\n'),
} = {}) {
  let current;
  return {
    mark(stage) {
      current = enabled && resourceStages.has(stage) ? stage : undefined;
    },
    clear() {
      current = undefined;
    },
    fail() {
      const stage = current;
      current = undefined;
      if (!stage) return;
      try {
        write(fixtureDiagnostic('FEAT-003', stage, 'failed', 'unclassified'));
      } catch {
        /* Observation cannot replace the existing rejection. */
      }
    },
  };
}
