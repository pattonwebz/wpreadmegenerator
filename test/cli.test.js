import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const cli = fileURLToPath(new URL('../dist/cli.js', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/official-readme.txt', import.meta.url));
const broken = fileURLToPath(new URL('./fixtures/broken-readme.txt', import.meta.url));

function run(args) {
  try {
    const stdout = execFileSync(process.execPath, [cli, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    return { code: 0, stdout };
  } catch (error) {
    return { code: error.status, stdout: error.stdout ?? '', stderr: error.stderr ?? '' };
  }
}

test('a clean-ish readme exits 0 and prints a summary', () => {
  const result = run([fixture]);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /error\(s\)/);
});

test('errors exit 1', () => {
  const result = run([broken]);
  assert.equal(result.code, 1);
});

test('a missing file exits 2', () => {
  const result = run(['does-not-exist.txt']);
  assert.equal(result.code, 2);
  assert.match(result.stderr, /cannot read/);
});

test('--help exits 0 without needing a file', () => {
  const result = run(['--help']);
  assert.equal(result.code, 0);
  assert.match(result.stdout, /usage: wpreadme/);
});

test('an unknown flag exits 2 rather than throwing', () => {
  const result = run(['--nope', fixture]);
  assert.equal(result.code, 2);
});

test('--json prints parseable findings', () => {
  const result = run(['--json', broken]);
  assert.equal(result.code, 1);
  const payload = JSON.parse(result.stdout);
  assert.ok(Array.isArray(payload.findings));
  assert.ok(payload.findings.some((finding) => finding.level === 'error'));
});

test('--plugin-file enables the stable tag cross-check', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wpreadme-'));
  const plugin = join(dir, 'plugin.php');
  writeFileSync(plugin, '<?php\n/**\n * Plugin Name: Thing\n * Version: 9.9.9\n */\n');

  const result = run(['--plugin-file', plugin, fixture]);
  assert.equal(result.code, 1);
  assert.match(result.stdout, /9\.9\.9/);
});

test('--fix writes nothing unless it is passed, and normalises when it is', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wpreadme-'));
  const target = join(dir, 'readme.txt');
  const messy = readFileSync(fixture, 'utf8').replace('\n== Description ==', '   \n\n\n== Description ==');
  writeFileSync(target, messy);

  run([target]);
  assert.equal(readFileSync(target, 'utf8'), messy, 'file must be untouched without --fix');

  const fixed = run(['--fix', target]);
  assert.equal(fixed.code, 0);
  assert.match(fixed.stdout, /normalised/);
  const after = readFileSync(target, 'utf8');
  assert.notEqual(after, messy);
  assert.ok(!/[ \t]+\n/.test(after), 'no trailing whitespace left');
  assert.ok(!/\n{3,}/.test(after), 'no runs of blank lines left');
});
