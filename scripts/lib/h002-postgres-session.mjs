import { spawn } from 'node:child_process';

const sqlStates = new Set([
  '22012',
  '23503',
  '23505',
  '23514',
  '25P03',
  '40001',
  '40P01',
  '42501',
  '42703',
  '57014',
  '08006',
]);

export class H002SqlError extends Error {
  constructor(reason, sqlState = 'unknown') {
    super(`H002 SQL session ${reason}`);
    this.sqlState = sqlStates.has(sqlState) ? sqlState : 'unknown';
  }
}

export function failureDetail(error) {
  if (error instanceof H002SqlError) return `sqlstate-${error.sqlState}`;
  return error?.code === 'ERR_ASSERTION' ? 'assertion' : 'internal';
}

// Only the disposable local Supabase container is addressable. No URL or secrets.
export function postgresSession(name) {
  const child = spawn(
    'docker',
    [
      'exec',
      '-i',
      '-e',
      `PGAPPNAME=${name}`,
      '-e',
      'PGOPTIONS=-c statement_timeout=15000 -c idle_in_transaction_session_timeout=15000',
      'supabase_db_flyeye',
      'psql',
      '-X',
      '-A',
      '-t',
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
      '-v',
      'VERBOSITY=sqlstate',
      '-U',
      'postgres',
      '-d',
      'postgres',
    ],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  );
  let output = '';
  let pending;
  let sequence = 0;
  let exited = false;
  let sqlState = 'unknown';
  let diagnosticTail = '';
  function fail(reason) {
    const request = pending;
    pending = undefined;
    request?.reject(new H002SqlError(reason, sqlState));
  }
  const closed = new Promise((resolve) => {
    child.on('close', () => {
      exited = true;
      fail('closed');
      resolve();
    });
  });
  child.on('error', () => fail('unavailable'));
  child.stdin.on('error', () => fail('input-failed'));
  child.stderr.on('data', (chunk) => {
    // Retain only a bounded parsing window; expose only allowlisted SQLSTATEs.
    diagnosticTail = (diagnosticTail + chunk.toString()).slice(-512);
    const match = /\b(?:ERROR|FATAL):\s+([0-9A-Z]{5})(?:\s|$)/.exec(diagnosticTail);
    if (match && sqlStates.has(match[1])) sqlState = match[1];
  });
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
    if (pending && output.includes(pending.marker)) {
      const result = output.slice(0, output.indexOf(pending.marker)).trim();
      output = output.slice(output.indexOf(pending.marker) + pending.marker.length).trimStart();
      pending.resolve(result);
      pending = undefined;
    }
  });
  return {
    async query(sql) {
      if (pending || exited) throw new H002SqlError('not-ready', sqlState);
      const marker = `h002_done_${++sequence}`;
      let timer;
      try {
        return await new Promise((resolve, reject) => {
          timer = setTimeout(() => {
            exited = true;
            fail('timeout');
            child.stdin.end();
          }, 20_000);
          pending = { marker, resolve, reject };
          child.stdin.write(`${sql}\n\\echo ${marker}\n`);
        });
      } finally {
        clearTimeout(timer);
      }
    },
    async close() {
      child.stdin.end();
      let timer;
      try {
        await Promise.race([
          closed,
          new Promise((_, reject) => {
            timer = setTimeout(() => {
              child.kill();
              reject(new H002SqlError('close-timeout'));
            }, 25_000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

export async function waitForSql(observer, sql) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if ((await observer.query(sql)) === 't') return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('Expected database interleaving was not observed');
}
