import { createHash, randomBytes } from 'node:crypto';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { localStaleProfile } from './local-stale-target.mjs';

const rejection = 'Local stale-factors workspace rejected.';
const check = (value) => {
  if (!value) throw new Error(rejection);
};
export const staleHash = (value) => createHash('sha256').update(value).digest('hex');
const roots = [
  'src',
  'public',
  'scripts',
  'supabase/functions',
  'supabase/migrations',
  'supabase/templates',
];
const files = [
  'package.json',
  'pnpm-lock.yaml',
  'index.html',
  'vite.config.ts',
  'tsconfig.json',
  'tsconfig.app.json',
  'tsconfig.node.json',
  'supabase/config.toml',
];

export function staleConfiguration(original) {
  original = original.replace(/\r\n/g, '\n');
  const replaceOnce = (input, pattern, replacement) => {
    check([...input.matchAll(new RegExp(pattern, 'gm'))].length === 1);
    return input.replace(new RegExp(pattern, 'm'), replacement);
  };
  let text = replaceOnce(
    original,
    '^project_id = "flyeye"$',
    `project_id = "${localStaleProfile.projectId}"`,
  );
  // Preserve every other Auth/Edge/template setting; only local profile addresses differ.
  for (let offset = 0; offset <= 8; offset++)
    text = replaceOnce(
      text,
      `^((?:port|shadow_port|smtp_port|pop3_port|vector_port) = )5532${offset}$`,
      (_match, prefix) => `${prefix}5832${offset}`,
    );
  text = replaceOnce(
    text,
    '^site_url = "http://127\\.0\\.0\\.1:5173"$',
    'site_url = "http://127.0.0.1:58329"',
  );
  check(!/^\[db\.seed\]/m.test(text));
  return `${text.trimEnd()}\n\n[db.seed]\nenabled = false\n`;
}

export function staleSourceInventory(source) {
  try {
    const entries = [];
    const visit = (relative) => {
      // Exclude environment files, including tracked examples, before reading them.
      if (relative.split(/[\\/]/).some((part) => part.startsWith('.env'))) return;
      const file = path.join(source, relative);
      const stat = lstatSync(file);
      check(!stat.isSymbolicLink());
      check(
        !relative
          .split(/[\\/]/)
          .some((part) => ['.git', '.supabase', 'node_modules'].includes(part)),
      );
      if (stat.isDirectory()) {
        for (const name of readdirSync(file).sort()) visit(`${relative}/${name}`);
      } else {
        check(stat.isFile() && stat.size <= 8 * 1024 * 1024);
        entries.push({ name: relative, sha256: staleHash(readFileSync(file)) });
      }
    };
    for (const relative of [...roots, ...files]) visit(relative);
    entries.sort((a, b) => a.name.localeCompare(b.name, 'en'));
    check(entries.length <= 5000);
    return { entries, digest: staleHash(JSON.stringify(entries)) };
  } catch {
    throw new Error(rejection);
  }
}

export function prepareStaleWorkspace(source, expectedDigest) {
  let root;
  try {
    const inventory = staleSourceInventory(source);
    check(/^[a-f0-9]{64}$/.test(expectedDigest) && expectedDigest === inventory.digest);
    const configuration = staleConfiguration(
      readFileSync(path.join(source, 'supabase/config.toml'), 'utf8'),
    );
    const dependencies = realpathSync(path.join(source, 'node_modules'));
    let bytes = 0;
    const inspectDependencies = (directory) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (['.cache', '.vite', '.vite-temp'].includes(entry.name)) continue;
        const file = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) {
          check(!path.isAbsolute(readlinkSync(file)));
          check(realpathSync(file).startsWith(dependencies + path.sep));
        } else if (entry.isDirectory()) inspectDependencies(file);
        else {
          check(entry.isFile());
          bytes += lstatSync(file).size;
          check(bytes <= 1024 ** 3);
        }
      }
    };
    inspectDependencies(dependencies);
    root = path.join(realpathSync(tmpdir()), `flyeye-stale-${randomBytes(16).toString('hex')}`);
    mkdirSync(root, { mode: 0o700 });
    for (const entry of inventory.entries) {
      const input = path.join(source, entry.name),
        output = path.join(root, entry.name);
      const content = readFileSync(input);
      check(staleHash(content) === entry.sha256);
      mkdirSync(path.dirname(output), { recursive: true });
      writeFileSync(output, content, { flag: 'wx', mode: 0o600 });
    }
    cpSync(dependencies, path.join(root, 'node_modules'), {
      recursive: true,
      dereference: false,
      verbatimSymlinks: true,
      errorOnExist: true,
      force: false,
      filter: (input) =>
        !path
          .relative(dependencies, input)
          .split(path.sep)
          .some((part) => ['.cache', '.vite', '.vite-temp'].includes(part)),
    });
    writeFileSync(path.join(root, 'supabase/config.toml'), configuration);
    check(staleSourceInventory(source).digest === expectedDigest);
    return { root, configuration, sourceDigest: expectedDigest };
  } catch {
    if (root) removeStaleWorkspace(root);
    throw new Error(rejection);
  }
}

export function removeStaleWorkspace(root) {
  check(existsSync(root) && !lstatSync(root).isSymbolicLink());
  check(realpathSync(root) === root && path.dirname(root) === realpathSync(tmpdir()));
  check(/^flyeye-stale-[a-f0-9]{32}$/.test(path.basename(root)));
  rmSync(root, { recursive: true, force: false });
  check(!existsSync(root));
}
