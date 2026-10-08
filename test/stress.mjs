#!/usr/bin/env node
/**
 * Stress pass against real readme.txt files pulled from the WordPress.org
 * plugin directory (plugins.svn.wordpress.org). Opt-in and network-dependent,
 * so it is not part of `npm test`.
 *
 *   npm run test:stress
 *
 * What it checks, per file: it parses without throwing, the plugin name is
 * recovered, a rebuild is stable (parse -> build -> parse keeps the fields),
 * and validate() does not throw on real-world mess.
 */
import { parseReadme, buildReadme, validate } from '../dist/index.js';

const SLUGS = [
  'akismet',
  'hello-dolly',
  'classic-editor',
  'contact-form-7',
  'wordpress-seo',
  'wp-super-cache',
  'jetpack',
  'woocommerce',
  'gutenberg',
  'query-monitor',
  'really-simple-ssl',
  'advanced-custom-fields',
  'wp-mail-smtp',
  'duplicate-post',
  'health-check',
  'redirection',
  'litespeed-cache',
  'all-in-one-seo-pack',
  'wpforms-lite',
  'autoptimize',
  'updraftplus',
  'ninja-forms',
  'tablepress',
  'custom-post-type-ui',
  'wp-crontrol',
  'simple-history',
  'admin-menu-editor',
  'limit-login-attempts-reloaded',
  'wp-statistics',
  'safe-svg',
  'wp-optimize',
  'shortcodes-ultimate',
];

const BASE = 'https://plugins.svn.wordpress.org';

async function fetchReadme(slug) {
  const url = `${BASE}/${slug}/trunk/readme.txt`;
  try {
    const response = await fetch(url);
    if (!response.ok) return { slug, error: `HTTP ${response.status}` };
    const text = await response.text();
    if (/<html/i.test(text.slice(0, 200))) return { slug, error: 'returned HTML, not a readme' };
    return { slug, text };
  } catch (error) {
    return { slug, error: error.message };
  }
}

function comparable(doc) {
  return {
    pluginName: doc.pluginName,
    contributors: doc.contributors,
    tags: doc.tags,
    stableTag: doc.stableTag,
    testedUpTo: doc.testedUpTo,
    requiresAtLeast: doc.requiresAtLeast,
    requiresPhp: doc.requiresPhp,
    license: doc.license,
    description: doc.sections.description,
    installation: doc.sections.installation,
    faq: doc.sections.faq,
    screenshots: doc.sections.screenshots,
    changelog: doc.sections.changelog,
    upgradeNotice: doc.sections.upgradeNotice,
    custom: doc.sections.custom,
  };
}

function differedFields(before, after) {
  const changed = [];
  for (const key of Object.keys(before)) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) changed.push(key);
  }
  return changed;
}

const results = [];

for (const slug of SLUGS) {
  const fetched = await fetchReadme(slug);
  if (fetched.error !== undefined) {
    results.push({ slug, status: `fetch failed: ${fetched.error}` });
    continue;
  }

  const text = fetched.text;
  try {
    const first = parseReadme(text);
    const rebuilt = buildReadme(first.doc);
    const second = parseReadme(rebuilt);

    const changed = differedFields(comparable(first.doc), comparable(second.doc));
    const findings = validate(first.doc, { readmeText: text });
    const errors = findings.filter((finding) => finding.level === 'error').length;
    const warnings = findings.filter((finding) => finding.level === 'warn').length;

    // Catch silent loss: if the file has a header line, the model must hold it.
    const lost = [];
    if (/^Contributors:/mi.test(text) && first.doc.contributors.length === 0) lost.push('contributors');
    if (/^Tags:/mi.test(text) && first.doc.tags.length === 0) lost.push('tags');
    if (/^Stable tag:/mi.test(text) && first.doc.stableTag === '') lost.push('stableTag');
    if (/^Tested up to:/mi.test(text) && first.doc.testedUpTo === '') lost.push('testedUpTo');
    if (/^License:/mi.test(text) && first.doc.license === '') lost.push('license');
    if (/^Donate link:/mi.test(text) && first.doc.donateLink === '') lost.push('donateLink');
    if (/^==\s*Description\s*==/mi.test(text) && first.doc.sections.description === '') lost.push('description');
    if (/^##\s+Description/mi.test(text) && first.doc.sections.description === '') lost.push('description');

    const unstable = changed.length > 0;
    const status = lost.length > 0
      ? `LOST FIELDS: ${lost.join(', ')}`
      : unstable
        ? `UNSTABLE: ${changed.join(', ')}`
        : 'ok';

    results.push({
      slug,
      bytes: text.length,
      name: first.doc.pluginName.slice(0, 34) || '(none!)',
      sections: first.doc.sections.custom.length + (first.doc.sections.faq.length > 0 ? 1 : 0) + 4,
      errors,
      warnings,
      rewritten: rebuilt.length,
      status,
    });
  } catch (error) {
    results.push({ slug, status: `THREW: ${error.message}` });
  }
}

const width = (value, size) => String(value ?? '').padEnd(size);
console.log(`${width('slug', 24)}${width('bytes', 8)}${width('errors', 8)}${width('warns', 7)}${width('status', 28)}name`);
console.log('-'.repeat(110));
for (const row of results) {
  console.log(`${width(row.slug, 24)}${width(row.bytes, 8)}${width(row.errors, 8)}${width(row.warnings, 7)}${width(row.status, 28)}${row.name ?? ''}`);
}

const fetchedCount = results.filter((row) => row.bytes !== undefined).length;
const unstable = results.filter((row) => typeof row.status === 'string' && row.status.startsWith('UNSTABLE'));
const threw = results.filter((row) => typeof row.status === 'string' && row.status.startsWith('THREW'));
const lost = results.filter((row) => typeof row.status === 'string' && row.status.startsWith('LOST FIELDS'));
const failed = results.filter((row) => typeof row.status === 'string' && row.status.startsWith('fetch failed'));

console.log('');
console.log(`${fetchedCount}/${SLUGS.length} fetched and parsed · ${lost.length} with lost fields · ${unstable.length} unstable · ${threw.length} threw · ${failed.length} unavailable`);
if (threw.length > 0) {
  console.log('\nCRASHES:');
  for (const row of threw) console.log(`  ${row.slug}: ${row.status}`);
}
if (lost.length > 0) {
  console.log('\nSILENTLY LOST FIELDS:');
  for (const row of lost) console.log(`  ${row.slug}: ${row.status}`);
}
if (unstable.length > 0) {
  console.log('\nUNSTABLE ROUND TRIPS:');
  for (const row of unstable) console.log(`  ${row.slug}: ${row.status}`);
}
process.exitCode = threw.length > 0 || lost.length > 0 || fetchedCount === 0 ? 1 : 0;
