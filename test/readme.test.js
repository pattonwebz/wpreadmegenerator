import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { buildReadme, emptyDoc, parseReadme, validate } from '../dist/index.js';

const fixture = readFileSync(new URL('./fixtures/official-readme.txt', import.meta.url), 'utf8');
const broken = readFileSync(new URL('./fixtures/broken-readme.txt', import.meta.url), 'utf8');

const levels = (findings) => findings.map((finding) => `${finding.level}:${finding.field}`);

test('buildReadme emits the header block in canonical order and omits empty fields', () => {
  const doc = {
    ...emptyDoc(),
    pluginName: 'My Plugin',
    tags: ['forms', '  spam  ', ''],
    stableTag: '1.0.0',
    shortDescription: 'A short one.',
  };

  assert.equal(buildReadme(doc), [
    '=== My Plugin ===',
    'Tags: forms, spam',
    'Stable tag: 1.0.0',
    '',
    'A short one.',
    '',
  ].join('\n'));
});

test('buildReadme appends unmodelled headers after the known ones', () => {
  const doc = { ...emptyDoc(), pluginName: 'X', shortDescription: 's', stableTag: '1.0' };
  doc.unparsedHeaders = ['Requires Plugins: woocommerce'];

  const lines = buildReadme(doc).split('\n');
  assert.equal(lines[0], '=== X ===');
  assert.equal(lines[1], 'Stable tag: 1.0');
  assert.equal(lines[2], 'Requires Plugins: woocommerce');
  assert.equal(lines[3], '');
  assert.equal(lines[4], 's');
});

test('buildReadme renders sections, FAQ blocks, numbered screenshots and changelog bullets', () => {
  const doc = emptyDoc();
  doc.pluginName = 'X';
  doc.shortDescription = 's';
  doc.sections.description = 'Long words.';
  doc.sections.faq = [{ q: 'Why?', a: 'Because.' }];
  doc.sections.screenshots = ['First shot', 'Second shot'];
  doc.sections.changelog = [{ version: '1.0', entries: ['Did a thing', 'Did another'] }];
  doc.sections.upgradeNotice = [{ version: '1.0', text: 'Upgrade.' }];
  doc.sections.custom = [{ title: 'Extra', body: 'Custom body.' }];

  const out = buildReadme(doc);
  assert.match(out, /== Description ==\n\nLong words\./);
  assert.match(out, /== Frequently Asked Questions ==\n\n= Why\? =\n\nBecause\./);
  assert.match(out, /== Screenshots ==\n\n1\. First shot\n2\. Second shot/);
  assert.match(out, /== Changelog ==\n\n= 1\.0 =\n\* Did a thing\n\* Did another/);
  assert.match(out, /== Upgrade Notice ==\n\n= 1\.0 =\n\nUpgrade\./);
  assert.match(out, /== Extra ==\n\nCustom body\./);
  assert.ok(out.endsWith('\n'));
});

test('the official sample readme round-trips without losing a field', () => {
  const { doc, warnings } = parseReadme(fixture);
  assert.deepEqual(warnings, []);

  assert.equal(doc.pluginName, 'Plugin Name');
  assert.deepEqual(doc.contributors, ["(this should be a list of wordpress.org userid's)"]);
  assert.equal(doc.donateLink, 'https://example.com/');
  assert.deepEqual(doc.tags, ['tag1', 'tag2']);
  assert.equal(doc.requiresAtLeast, '4.7');
  assert.equal(doc.testedUpTo, '5.4');
  assert.equal(doc.stableTag, '4.3');
  assert.equal(doc.requiresPhp, '7.0');
  assert.equal(doc.license, 'GPLv2 or later');
  assert.equal(doc.licenseUri, 'https://www.gnu.org/licenses/gpl-2.0.html');
  assert.match(doc.shortDescription, /^Here is a short description/);
  assert.deepEqual(doc.unparsedHeaders, []);

  assert.equal(doc.sections.faq.length, 2);
  assert.deepEqual(doc.sections.faq[1], { q: 'What about foo bar?', a: 'Answer to foo bar dilemma.' });
  assert.equal(doc.sections.screenshots.length, 2);
  assert.match(doc.sections.screenshots[0], /^This screen shot description/);
  assert.deepEqual(doc.sections.changelog.map((entry) => entry.version), ['1.0', '0.5']);
  assert.deepEqual(doc.sections.changelog[0].entries, ['A change since the previous version.', 'Another change.']);
  assert.equal(doc.sections.upgradeNotice.length, 2);
  assert.equal(doc.sections.custom.length, 1);
  assert.equal(doc.sections.custom[0].title, 'A brief Markdown Example');

  // Rebuild and compare the parts that must survive.
  const rebuilt = parseReadme(buildReadme(doc)).doc;
  assert.equal(rebuilt.pluginName, doc.pluginName);
  assert.deepEqual(rebuilt.tags, doc.tags);
  assert.equal(rebuilt.stableTag, doc.stableTag);
  assert.equal(rebuilt.sections.description, doc.sections.description);
  assert.deepEqual(rebuilt.sections.faq, doc.sections.faq);
  assert.deepEqual(rebuilt.sections.changelog, doc.sections.changelog);
  assert.deepEqual(rebuilt.sections.custom, doc.sections.custom);
});

test('unmodelled headers survive a parse/build cycle', () => {
  const withExtra = fixture.replace('License URI: https://www.gnu.org/licenses/gpl-2.0.html', 'License URI: https://www.gnu.org/licenses/gpl-2.0.html\nRequires Plugins: woocommerce');
  const { doc } = parseReadme(withExtra);
  assert.deepEqual(doc.unparsedHeaders, ['Requires Plugins: woocommerce']);
  assert.match(buildReadme(doc), /^Requires Plugins: woocommerce$/m);
});

test('the official sample produces no errors', () => {
  const { doc } = parseReadme(fixture);
  const findings = validate(doc, { readmeText: fixture });
  assert.deepEqual(findings.filter((finding) => finding.level === 'error'), []);
});

test('requirements are flagged as informational, citing WordPress 5.8', () => {
  const { doc } = parseReadme(fixture);
  const findings = validate(doc);
  const note = findings.find((finding) => finding.field === 'requiresAtLeast' && finding.level === 'info');
  assert.ok(note, 'expected an informational finding for Requires at least');
  assert.match(note.message, /5\.8/);
  assert.match(note.message, /plugin's main PHP file/);
});

test('validate reports the rules that matter', () => {
  const { doc } = parseReadme(broken);
  const findings = validate(doc, { readmeText: broken });
  const report = levels(findings);

  assert.ok(report.includes('warn:shortDescription'), 'long short description');
  assert.ok(report.includes('warn:tags'), 'more than five tags');
  assert.ok(report.includes('error:requiresAtLeast'), 'malformed requires at least');
  assert.ok(report.includes('error:requiresPhp'), 'malformed requires PHP');
  assert.ok(report.includes('warn:testedUpTo'), 'minor version in tested up to');
  assert.ok(report.includes('error:stableTag'), 'stable tag is not a version number');
  assert.ok(report.includes('warn:contributors'), 'email address as contributor');
  assert.ok(report.includes('error:donateLink'), 'malformed donate link');
  assert.ok(report.includes('warn:upgradeNotice'), 'upgrade notice over 300 characters');
  assert.ok(report.includes('info:changelog'), 'changelog out of order');
});

test('R7 catches a stable tag that disagrees with the plugin header', () => {
  const { doc } = parseReadme(fixture);
  const findings = validate(doc, { pluginHeaderVersion: '4.4' });
  const mismatch = findings.find((finding) => finding.field === 'stableTag' && finding.level === 'error');
  assert.ok(mismatch, 'expected a stable tag mismatch error');
  assert.match(mismatch.message, /4\.3/);
  assert.match(mismatch.message, /4\.4/);

  const agreeing = validate(doc, { pluginHeaderVersion: '4.3' });
  assert.equal(agreeing.filter((finding) => finding.level === 'error').length, 0);
});

test('a readme over 10 KB is warned about', () => {
  const doc = emptyDoc();
  doc.pluginName = 'Big';
  doc.shortDescription = 's';
  doc.sections.description = 'x'.repeat(11 * 1024);
  const findings = validate(doc);
  assert.ok(findings.some((finding) => finding.field === 'readme' && finding.level === 'warn'));
});

// Regression: the directory also accepts Markdown headings. Verified against a
// live plugin whose readme.txt uses "#  Name / ## Section / ### Item" and whose
// directory listing parses fully. Being stricter than the real parser meant
// losing the plugin name on import.
test('Markdown-style headings are parsed, not rejected', () => {
  const markdown = readFileSync(new URL('./fixtures/markdown-readme.txt', import.meta.url), 'utf8');
  const { doc, warnings } = parseReadme(markdown);

  assert.equal(doc.pluginName, 'Query Monitor');
  assert.deepEqual(doc.tags, ['debug', 'debug-bar', 'development', 'performance', 'query monitor']);
  assert.equal(doc.stableTag, '4.0.7');
  assert.equal(doc.license, 'GPL v2 or later');
  assert.equal(doc.donateLink, 'https://github.com/sponsors/johnbillion');
  assert.equal(doc.shortDescription, 'Query Monitor is the developer tools panel for WordPress and WooCommerce.');

  assert.equal(doc.sections.faq.length, 2);
  assert.equal(doc.sections.faq[0].q, 'Does this plugin work with PHP 8?');
  assert.equal(doc.sections.faq[0].a, 'Yes, it does.');
  assert.deepEqual(doc.sections.screenshots, ['The admin toolbar menu item.', 'The overview panel.']);
  assert.deepEqual(doc.sections.changelog.map((entry) => entry.version), [
    '1.0.0 (20 June 2026)',
    '0.9.0 (11 April 2026)',
  ]);
  assert.deepEqual(doc.sections.changelog[0].entries, ['Initial release.', 'Another change.']);

  // "### Browser extension" is a sub-heading inside the description, not a FAQ item.
  assert.match(doc.sections.description, /Browser extension/);
  assert.equal(doc.sections.faq.some((item) => item.q.includes('Browser extension')), false);

  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Markdown headings/);
});

test('a rebuilt Markdown readme uses the documented === / == syntax', () => {
  const markdown = readFileSync(new URL('./fixtures/markdown-readme.txt', import.meta.url), 'utf8');
  const rebuilt = buildReadme(parseReadme(markdown).doc);
  assert.match(rebuilt, /^=== Query Monitor ===$/m);
  assert.match(rebuilt, /^== Description ==$/m);
  assert.match(rebuilt, /^== Frequently Asked Questions ==$/m);
  assert.match(rebuilt, /^= Does this plugin work with PHP 8\? =$/m);
  assert.equal(/^## /m.test(rebuilt), false);
});

// Regression: a documented-format readme whose Description uses Markdown
// sub-headings inside it (Yoast SEO's does). Deciding the heading dialect
// per line rather than per file emptied the description and scattered the
// sub-headings into custom sections.
test('Markdown sub-headings inside a documented == Description == stay in the description', () => {
  const mixed = [
    '=== Mixed Plugin ===',
    'Tags: one, two',
    'Stable tag: 1.0.0',
    '',
    'Short description here.',
    '',
    '== Description ==',
    '',
    'Opening paragraph.',
    '',
    '## A Markdown sub-heading',
    '',
    'Body under the sub-heading.',
    '',
    '### A deeper sub-heading',
    '',
    'More body.',
    '',
    '== Frequently Asked Questions ==',
    '',
    '= Does it work? =',
    '',
    'Yes.',
    '',
  ].join('\n');

  const { doc, warnings } = parseReadme(mixed);

  assert.match(doc.sections.description, /Opening paragraph\./);
  assert.match(doc.sections.description, /## A Markdown sub-heading/);
  assert.match(doc.sections.description, /### A deeper sub-heading/);
  assert.match(doc.sections.description, /More body\./);
  assert.deepEqual(doc.sections.custom, [], 'no sub-headings promoted to sections');
  assert.deepEqual(doc.sections.faq, [{ q: 'Does it work?', a: 'Yes.' }]);
  assert.deepEqual(warnings, [], 'documented format, so no Markdown warning');
});

test('a Markdown-style FAQ splits on ### even though the file has no == sections', () => {
  const markdown = [
    '# Markdown Plugin',
    '',
    'Short.',
    '',
    '## Frequently Asked Questions',
    '',
    '### First question?',
    '',
    'First answer.',
    '',
    '### Second question?',
    '',
    'Second answer.',
    '',
  ].join('\n');

  const { doc } = parseReadme(markdown);
  assert.deepEqual(doc.sections.faq, [
    { q: 'First question?', a: 'First answer.' },
    { q: 'Second question?', a: 'Second answer.' },
  ]);
});

// Regression: WP Super Cache is a Markdown readme containing exactly one
// documented-style line (`== Changelog ==`). Deciding the dialect from "does
// the file contain any == section" flipped the whole file and emptied it.
test('one stray == section does not flip a Markdown readme', () => {
  const mostlyMarkdown = [
    '=== Stray Plugin ===',
    'Tags: one',
    'Stable tag: 1.0.0',
    '',
    'Short description.',
    '',
    '## Description ##',
    'The description body.',
    '',
    '### Recommended Settings ###',
    'Nested sub-heading that belongs to the description.',
    '',
    '## Frequently Asked Questions ##',
    '',
    '### Does it work? ###',
    '',
    'Yes it does.',
    '',
    '== Changelog ==',
    '',
    '### 1.0.0 - 2026-09-30',
    '* Initial release.',
    '',
  ].join('\n');

  const { doc } = parseReadme(mostlyMarkdown);

  assert.match(doc.sections.description, /The description body\./);
  assert.match(doc.sections.description, /Nested sub-heading/);
  assert.deepEqual(doc.sections.faq, [{ q: 'Does it work?', a: 'Yes it does.' }]);
  assert.deepEqual(doc.sections.changelog, [{ version: '1.0.0 - 2026-09-30', entries: ['Initial release.'] }]);
});

// Regression: Ninja Forms groups its header block with blank lines between the
// groups. Stopping at the first blank line silently dropped Stable tag,
// Tested up to and License.
test('a header block split by blank lines is still read in full', () => {
  const grouped = [
    '=== Grouped Plugin ===',
    'Contributors: someone',
    'Tags: forms, builder',
    '',
    'Requires at least: 6.9',
    'Tested up to: 7.1',
    'Stable tag: 3.15.5',
    'Requires PHP: 7.4',
    '',
    'License: GPLv2 or later',
    '',
    'The short description comes after all of that.',
    '',
    '== Description ==',
    '',
    'Body.',
    '',
  ].join('\n');

  const { doc } = parseReadme(grouped);

  assert.equal(doc.pluginName, 'Grouped Plugin');
  assert.deepEqual(doc.tags, ['forms', 'builder']);
  assert.equal(doc.requiresAtLeast, '6.9');
  assert.equal(doc.testedUpTo, '7.1');
  assert.equal(doc.stableTag, '3.15.5');
  assert.equal(doc.requiresPhp, '7.4');
  assert.equal(doc.license, 'GPLv2 or later');
  assert.equal(doc.shortDescription, 'The short description comes after all of that.');
  assert.equal(doc.sections.description, 'Body.');
});

// Regression: UpdraftPlus's License section is an indented code block.
// Trimming the body with String.trim() ate the first line's indentation.
test('indentation inside a section body survives a round trip', () => {
  const indented = [
    '=== Indented Plugin ===',
    'Tags: one',
    'Stable tag: 1.0.0',
    '',
    'Short.',
    '',
    '== License ==',
    '',
    '    Copyright 2011-26 Someone',
    '',
    '    This program is free software.',
    '',
  ].join('\n');

  const first = parseReadme(indented).doc;
  assert.match(first.sections.custom[0].body, /^ {4}Copyright 2011-26 Someone$/m);
  assert.match(first.sections.custom[0].body, /^ {4}This program is free software\.$/m);

  const second = parseReadme(buildReadme(first)).doc;
  assert.equal(second.sections.custom[0].body, first.sections.custom[0].body);
});
