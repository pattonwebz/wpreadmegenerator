/**
 * The core is imported by the browser bundle as well as by Node, so it must not
 * touch Node-only globals. A `Buffer` reference in validate.ts compiled fine and
 * passed every unit test — because Node provides Buffer — and only crashed in a
 * real browser. This test exists so that cannot happen again.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const srcDir = fileURLToPath(new URL('../src', import.meta.url));

/** Only cli.ts is allowed to touch Node; it is never exported to browsers. */
const NODE_ALLOWED = new Set(['cli.ts']);

const NODE_ONLY = [
  /\bBuffer\b/,
  /\bprocess\./,
  /\b__dirname\b/,
  /\b__filename\b/,
  /\brequire\s*\(/,
  /from\s+['"]node:/,
  /\bimport\s*\(\s*['"]node:/,
];

/** Comments mention these words on purpose; only real code should be checked. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
}

test('only cli.ts imports node: builtins', () => {
  for (const file of readdirSync(srcDir)) {
    if (!file.endsWith('.ts') || NODE_ALLOWED.has(file)) continue;
    const source = stripComments(readFileSync(join(srcDir, file), 'utf8'));
    for (const pattern of NODE_ONLY) {
      const match = pattern.exec(source);
      assert.equal(match, null, `${file} must stay environment-free but matches ${pattern}: ${match ? match[0] : ''}`);
    }
  }
});

test('cli.ts does import node: builtins, which is its job', () => {
  const source = readFileSync(join(srcDir, 'cli.ts'), 'utf8');
  assert.match(source, /from 'node:/);
});

test('the cross-environment byte count does not rely on Buffer', () => {
  const source = stripComments(readFileSync(join(srcDir, 'validate.ts'), 'utf8'));
  assert.match(source, /TextEncoder/);
  assert.equal(/\bBuffer\b/.test(source), false);
});
