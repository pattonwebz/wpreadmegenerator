import { emptyDoc, trimBlankLines, type ChangelogEntry, type FaqItem, type ReadmeDoc, type UpgradeNoticeEntry } from './model.js';
import { HEADER_FIELDS } from './build.js';

export interface ParseResult {
  doc: ReadmeDoc;
  /** Non-fatal notes about the file itself, not about its content. */
  warnings: string[];
}

/**
 * The directory's documented format is `=== Plugin Name ===` / `== Section ==`.
 * It also accepts Markdown headings — verified against live plugins whose
 * readme.txt uses `# Name`, `## Section`, `### Item` and whose listings parse
 * fully. Being stricter than the real parser loses data on import.
 *
 * Critically, the dialect is decided **per file**, not per line: a readme that
 * uses `== Description ==` may well use `##` headings *inside* that description
 * as sub-headings (Yoast SEO's does). Treating those `##` lines as new sections
 * would empty the description entirely.
 */
const TITLE_EQUALS_RE = /^===\s*(.*?)\s*===$/;
const TITLE_HASH_RE = /^#\s+(.*?)\s*#*$/;
const SECTION_HASH_RE = /^##\s+(.+?)\s*#*$/;
const SUB_EQUALS_RE = /^=\s*(.+?)\s*=$/;
const SUB_HASH_RE = /^###\s+(.+?)\s*#*$/;

const HEADER_RE = /^([A-Za-z][A-Za-z ]*?):\s*(.*)$/;
const SCREENSHOT_RE = /^\d+\.\s*(.*)$/;
const BULLET_RE = /^[*\-]\s*(.*)$/;

const MARKDOWN_WARNING = 'This readme uses Markdown headings. The directory accepts them, but the documented format is "=== Plugin Name ===" for the title and "== Section ==" for sections — which is what the generator writes.';

/** `== Section ==`, explicitly not the `=== Title ===` line. */
function equalsSectionTitle(line: string): string | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith('==') || trimmed.startsWith('===')) return null;
  const match = /^==\s*(.+?)\s*==$/.exec(trimmed);
  return match === null ? null : (match[1] ?? '').trim();
}

export function sectionHeading(line: string, preferEquals: boolean): string | null {
  const equals = equalsSectionTitle(line);
  if (equals !== null) return equals;
  if (preferEquals) return null;
  const hash = SECTION_HASH_RE.exec(line.trim());
  return hash === null ? null : (hash[1] ?? '').trim();
}

export function subHeading(line: string, preferEquals: boolean): string | null {
  const trimmed = line.trim();
  if (preferEquals) {
    const equals = SUB_EQUALS_RE.exec(trimmed);
    return equals === null ? null : (equals[1] ?? '').trim();
  }
  const equals = SUB_EQUALS_RE.exec(trimmed);
  if (equals !== null) return (equals[1] ?? '').trim();
  const hash = SUB_HASH_RE.exec(trimmed);
  return hash === null ? null : (hash[1] ?? '').trim();
}

/**
 * Decide the heading dialect from the *first* section heading in the file.
 *
 * Counting markers does not work: WP Super Cache is a Markdown readme with one
 * stray `== Changelog ==` line, while Yoast SEO is a documented readme with
 * `##` sub-headings inside its `== Description ==`. In both, the first heading
 * correctly identifies the style the author was writing in.
 */
function prefersEqualsSections(lines: string[]): boolean {
  for (const line of lines) {
    if (equalsSectionTitle(line) !== null) return true;
    if (SECTION_HASH_RE.test(line.trim())) return false;
  }
  return true;
}

const KNOWN_SECTION_KEYS = new Map<string, 'description' | 'installation' | 'faq' | 'screenshots' | 'changelog' | 'upgradeNotice'>([
  ['description', 'description'],
  ['installation', 'installation'],
  ['frequently asked questions', 'faq'],
  ['faq', 'faq'],
  ['screenshots', 'screenshots'],
  ['changelog', 'changelog'],
  ['upgrade notice', 'upgradeNotice'],
]);

interface RawSection {
  title: string;
  lines: string[];
}

/**
 * Split a FAQ / changelog / upgrade-notice body into its entries, using whichever
 * sub-heading dialect that section actually uses.
 */
function splitSubBlocks(lines: string[]): RawSection[] {
  const preferEquals = lines.some((line) => SUB_EQUALS_RE.test(line.trim()));
  const blocks: RawSection[] = [];
  let current: RawSection | null = null;

  for (const line of lines) {
    const heading = subHeading(line, preferEquals);
    if (heading !== null) {
      if (current !== null) blocks.push(current);
      current = { title: heading, lines: [] };
      continue;
    }
    if (current === null) {
      current = { title: '', lines: [] };
    }
    current.lines.push(line);
  }
  if (current !== null) blocks.push(current);
  return blocks;
}

function body(lines: string[]): string {
  return trimBlankLines(lines.join('\n'));
}

function parseFaq(lines: string[]): FaqItem[] {
  return splitSubBlocks(lines)
    .filter((block) => block.title !== '')
    .map((block) => ({ q: block.title, a: body(block.lines) }));
}

function parseScreenshots(lines: string[]): string[] {
  const captions: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const match = SCREENSHOT_RE.exec(trimmed);
    captions.push(match !== null ? (match[1] ?? '').trim() : trimmed);
  }
  return captions;
}

function parseChangelog(lines: string[]): ChangelogEntry[] {
  return splitSubBlocks(lines)
    .filter((block) => block.title !== '')
    .map((block) => ({
      version: block.title,
      entries: block.lines
        .map((line) => line.trim())
        .filter((line) => line !== '')
        .map((line) => {
          const bullet = BULLET_RE.exec(line);
          return bullet !== null ? (bullet[1] ?? '').trim() : line;
        }),
    }));
}

function parseUpgradeNotice(lines: string[]): UpgradeNoticeEntry[] {
  return splitSubBlocks(lines)
    .filter((block) => block.title !== '')
    .map((block) => ({ version: block.title, text: body(block.lines) }));
}

/**
 * Parse a readme.txt into the document model.
 *
 * Tolerant by design: unknown header lines are preserved verbatim in
 * `unparsedHeaders`, unknown sections become custom sections, Markdown headings
 * are accepted alongside the documented syntax, and screenshots without a
 * leading number are still read as captions. Real readmes are messy and
 * refusing to read them is not helpful.
 */
export function parseReadme(text: string): ParseResult {
  const warnings: string[] = [];
  const doc = emptyDoc();
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const preferEqualsSections = prefersEqualsSections(lines);

  let index = 0;
  let markdownHeadings = false;

  const byLabel = new Map<string, { key: keyof ReadmeDoc; kind: 'list' | 'scalar' }>();
  for (const [label, key, kind] of HEADER_FIELDS) {
    byLabel.set(label.toLowerCase(), { key, kind });
  }

  const first = (lines[0] ?? '').trim();
  const equalsTitle = TITLE_EQUALS_RE.exec(first);
  const hashTitle = equalsTitle === null ? TITLE_HASH_RE.exec(first) : null;
  if (equalsTitle !== null) {
    doc.pluginName = (equalsTitle[1] ?? '').trim();
    index = 1;
  } else if (hashTitle !== null) {
    doc.pluginName = (hashTitle[1] ?? '').trim();
    markdownHeadings = true;
    index = 1;
  } else {
    warnings.push('No "=== Plugin Name ===" line found — this may not be a readme.txt.');
  }

  // Real readmes often put a blank line between the title and the header block,
  // and the directory still reads the headers. Only skip those blanks when what
  // follows is genuinely a header line, so a short description that merely spans
  // a paragraph break is not mistaken for one.
  let scan = index;
  while (scan < lines.length && (lines[scan] ?? '').trim() === '') scan += 1;
  const candidate = HEADER_RE.exec(lines[scan] ?? '');
  if (candidate !== null && byLabel.has((candidate[1] ?? '').trim().toLowerCase())) {
    index = scan;
  }

  // The header block: `Label: value` lines, tolerating blank lines between groups
  // of them (Ninja Forms groups its headers that way, and the directory still
  // reads them all). Unknown labels are kept verbatim. A blank line followed by
  // a line that is not a known header ends the block, so a short description is
  // never mistaken for one.
  let sawBlank = false;
  for (; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const trimmedLine = line.trim();
    if (trimmedLine === '') {
      sawBlank = true;
      continue;
    }
    const match = HEADER_RE.exec(line);
    const label = match === null ? '' : (match[1] ?? '').trim().toLowerCase();
    if (sawBlank && !byLabel.has(label)) break;
    if (match === null) {
      doc.unparsedHeaders.push(trimmedLine);
      sawBlank = false;
      continue;
    }
    const value = (match[2] ?? '').trim();
    const known = byLabel.get(label);
    if (known === undefined) {
      doc.unparsedHeaders.push(trimmedLine);
      sawBlank = false;
      continue;
    }
    sawBlank = false;
    if (known.kind === 'list') {
      const list = value
        .split(',')
        .map((item) => item.trim())
        .filter((item) => item !== '');
      if (known.key === 'contributors') doc.contributors = list;
      else if (known.key === 'tags') doc.tags = list;
    } else if (known.key === 'donateLink') {
      doc.donateLink = value;
    } else if (known.key === 'requiresAtLeast') {
      doc.requiresAtLeast = value;
    } else if (known.key === 'testedUpTo') {
      doc.testedUpTo = value;
    } else if (known.key === 'stableTag') {
      doc.stableTag = value;
    } else if (known.key === 'requiresPhp') {
      doc.requiresPhp = value;
    } else if (known.key === 'license') {
      doc.license = value;
    } else if (known.key === 'licenseUri') {
      doc.licenseUri = value;
    }
  }

  // Short description: the first non-empty line after the header block.
  for (; index < lines.length; index += 1) {
    const line = (lines[index] ?? '').trim();
    if (sectionHeading(line, true) !== null || sectionHeading(line, false) !== null) break;
    if (line !== '') {
      doc.shortDescription = line;
      index += 1;
      break;
    }
  }

  // Sections.
  const sections: RawSection[] = [];
  let current: RawSection | null = null;
  for (; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const heading = sectionHeading(line, preferEqualsSections);
    if (heading !== null) {
      if (current !== null) sections.push(current);
      if (!preferEqualsSections) markdownHeadings = true;
      current = { title: heading, lines: [] };
      continue;
    }
    if (current !== null) current.lines.push(line);
  }
  if (current !== null) sections.push(current);

  for (const section of sections) {
    const key = KNOWN_SECTION_KEYS.get(section.title.toLowerCase());
    if (key === 'description') doc.sections.description = body(section.lines);
    else if (key === 'installation') doc.sections.installation = body(section.lines);
    else if (key === 'faq') doc.sections.faq = parseFaq(section.lines);
    else if (key === 'screenshots') doc.sections.screenshots = parseScreenshots(section.lines);
    else if (key === 'changelog') doc.sections.changelog = parseChangelog(section.lines);
    else if (key === 'upgradeNotice') doc.sections.upgradeNotice = parseUpgradeNotice(section.lines);
    else doc.sections.custom.push({ title: section.title, body: body(section.lines) });
  }

  if (markdownHeadings) warnings.push(MARKDOWN_WARNING);

  return { doc, warnings };
}
