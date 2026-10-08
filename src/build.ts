import type { ReadmeDoc } from './model.js';
import { trimBlankLines } from './model.js';

/**
 * Canonical header order. The directory's parser is order-tolerant, but a fixed
 * order keeps diffs meaningful and matches the official sample readme.txt.
 */
export const HEADER_FIELDS: ReadonlyArray<readonly [label: string, key: keyof ReadmeDoc, kind: 'list' | 'scalar']> = [
  ['Contributors', 'contributors', 'list'],
  ['Donate link', 'donateLink', 'scalar'],
  ['Tags', 'tags', 'list'],
  ['Requires at least', 'requiresAtLeast', 'scalar'],
  ['Tested up to', 'testedUpTo', 'scalar'],
  ['Stable tag', 'stableTag', 'scalar'],
  ['Requires PHP', 'requiresPhp', 'scalar'],
  ['License', 'license', 'scalar'],
  ['License URI', 'licenseUri', 'scalar'],
];

export function joinList(values: readonly string[]): string {
  return values
    .map((value) => value.trim())
    .filter((value) => value !== '')
    .join(', ');
}

function headerValue(doc: ReadmeDoc, key: keyof ReadmeDoc, kind: 'list' | 'scalar'): string {
  const raw = doc[key];
  if (kind === 'list') {
    return Array.isArray(raw) ? joinList(raw as string[]) : '';
  }
  return typeof raw === 'string' ? raw.trim() : '';
}

/**
 * Render the header block, then a blank line, then the single-line short
 * description. Empty fields are omitted entirely — the directory reads an
 * empty `Field:` line as a present-but-garbage value, which is worse than absent.
 */
export function buildHeader(doc: ReadmeDoc): string {
  const lines: string[] = [`=== ${doc.pluginName.trim()} ===`];

  for (const [label, key, kind] of HEADER_FIELDS) {
    const value = headerValue(doc, key, kind);
    if (value !== '') {
      lines.push(`${label}: ${value}`);
    }
  }

  for (const extra of doc.unparsedHeaders) {
    const trimmed = extra.trim();
    if (trimmed !== '') {
      lines.push(trimmed);
    }
  }

  lines.push('', doc.shortDescription.trim());
  return lines.join('\n');
}

function namedSection(title: string, body: string): string {
  const trimmed = trimBlankLines(body);
  return trimmed === '' ? '' : `== ${title} ==\n\n${trimmed}`;
}

function subBlock(heading: string, body: string): string {
  return `= ${heading.trim()} =\n\n${trimBlankLines(body)}`;
}

export function buildReadme(doc: ReadmeDoc): string {
  const blocks: string[] = [buildHeader(doc)];

  const { sections } = doc;

  const description = namedSection('Description', sections.description);
  if (description !== '') blocks.push(description);

  const installation = namedSection('Installation', sections.installation);
  if (installation !== '') blocks.push(installation);

  if (sections.faq.length > 0) {
    const items = sections.faq
      .filter((item) => item.q.trim() !== '' || item.a.trim() !== '')
      .map((item) => subBlock(item.q, item.a));
    if (items.length > 0) {
      blocks.push(`== Frequently Asked Questions ==\n\n${items.join('\n\n')}`);
    }
  }

  if (sections.screenshots.length > 0) {
    const shots = sections.screenshots
      .map((caption) => caption.trim())
      .filter((caption) => caption !== '')
      .map((caption, index) => `${index + 1}. ${caption}`);
    if (shots.length > 0) {
      blocks.push(`== Screenshots ==\n\n${shots.join('\n')}`);
    }
  }

  if (sections.changelog.length > 0) {
    const versions = sections.changelog
      .filter((entry) => entry.version.trim() !== '')
      .map((entry) => {
        const bullets = entry.entries
          .map((line) => line.trim())
          .filter((line) => line !== '')
          .map((line) => `* ${line}`);
        return bullets.length > 0
          ? `= ${entry.version.trim()} =\n${bullets.join('\n')}`
          : `= ${entry.version.trim()} =`;
      });
    if (versions.length > 0) {
      blocks.push(`== Changelog ==\n\n${versions.join('\n\n')}`);
    }
  }

  if (sections.upgradeNotice.length > 0) {
    const notices = sections.upgradeNotice
      .filter((entry) => entry.version.trim() !== '')
      .map((entry) => subBlock(entry.version, entry.text));
    if (notices.length > 0) {
      blocks.push(`== Upgrade Notice ==\n\n${notices.join('\n\n')}`);
    }
  }

  for (const section of sections.custom) {
    const rendered = namedSection(section.title, section.body);
    if (rendered !== '') blocks.push(rendered);
  }

  return `${blocks.join('\n\n')}\n`;
}
