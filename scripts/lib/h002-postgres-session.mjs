import { spawn } from 'node:child_process';

// Only the disposable local Supabase container is addressable. No URL or secrets.
export function postgresSession(name) {
  const child = spawn(
    'docker',
    [
      'exec',
      '-i',
      '-e',
      `PGAPPNAME=${name}`,
      'supabase_db_flyeye',
      'psql',
      '-X',
      '-A',
      '-t',
      '-q',
      '-v',
      'ON_ERROR_STOP=1',
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
  const closed = new Promise((resolve) => {
    child.on('close', () => {
      exited = true;
      pending?.reject(new Error('SQL session closed'));
      resolve();
    });
  });
  child.on('error', () => pending?.reject(new Error('SQL session unavailable')));
  child.stderr.on('data', () => {}); // Never forward raw database errors or payloads.
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
      if (pending || exited) throw new Error('SQL session not ready');
      const marker = `h002_done_${++sequence}`;
      let timer;
      try {
        return await new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(new Error('SQL session timeout')), 20_000);
          pending = { marker, resolve, reject };
          child.stdin.write(`${sql}\n\\echo ${marker}\n`);
        });
      } finally {
        clearTimeout(timer);
      }
    },
    async close() {
      child.stdin.end();
      await closed;
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
