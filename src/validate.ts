import { buildReadme } from './build.js';
import type { Finding, ReadmeDoc } from './model.js';

export interface ValidateOptions {
  /** The rendered readme, used for the file-size rule. Built from `doc` when absent. */
  readmeText?: string;
  /** `Version:` from the plugin's main PHP file. Enables the stable-tag cross-check. */
  pluginHeaderVersion?: string;
}

const HANDBOOK = 'https://developer.wordpress.org/plugins/wordpress-org/how-your-readme-txt-works/';
const ASSETS = 'https://developer.wordpress.org/plugins/wordpress-org/plugin-assets/';

const VERSION_RE = /^\d+(\.\d+)*$/;
const MAX_README_BYTES = 10 * 1024;

/**
 * UTF-8 byte length. Deliberately not `Buffer.byteLength` — this module runs in
 * the browser too, where Buffer does not exist, and the failure is a runtime
 * crash rather than a build error.
 */
function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).length;
}

function isUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function compareVersions(a: string, b: string): number {
  const left = a.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const right = b.split('.').map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

/**
 * Check a document against the rules the WordPress.org directory actually
 * applies. Warnings never block anything — they are there to be read.
 */
export function validate(doc: ReadmeDoc, options: ValidateOptions = {}): Finding[] {
  const found: Finding[] = [];
  const add = (level: Finding['level'], field: string, message: string, source: string): void => {
    found.push({ level, field, message, source });
  };

  // R1 — short description length and markup.
  const short = doc.shortDescription.trim();
  if (short === '') {
    add('warn', 'shortDescription', 'No short description. It is the one-line summary shown under the plugin name.', HANDBOOK);
  } else if (short.length > 150) {
    add('warn', 'shortDescription', `Short description is ${short.length} characters; the directory truncates at 150.`, HANDBOOK);
  } else if (short.length >= 130) {
    add('info', 'shortDescription', `Short description is ${short.length} characters — close to the 150 limit.`, HANDBOOK);
  }
  if (/[*_`[\]]/.test(short)) {
    add('warn', 'shortDescription', 'Short description contains markup. The directory expects plain text here.', HANDBOOK);
  }

  // R2 — tags.
  if (doc.tags.length === 0) {
    add('info', 'tags', 'No tags. Tags are how people find the plugin in search.', HANDBOOK);
  } else if (doc.tags.length > 5) {
    add('warn', 'tags', `${doc.tags.length} tags; only the first 5 are indexed.`, HANDBOOK);
  }

  // R3 / R4 — version formats, plus the WordPress 5.8 caveat nobody surfaces.
  if (doc.requiresAtLeast !== '' && !VERSION_RE.test(doc.requiresAtLeast)) {
    add('error', 'requiresAtLeast', `"${doc.requiresAtLeast}" is not a version number. Use numbers only, e.g. "6.5" not "WP 6.5".`, HANDBOOK);
  }
  if (doc.requiresPhp !== '' && !VERSION_RE.test(doc.requiresPhp)) {
    add('error', 'requiresPhp', `"${doc.requiresPhp}" is not a version number. Use numbers only, e.g. "7.4" not "PHP 7.4".`, HANDBOOK);
  }
  if (doc.requiresAtLeast !== '' || doc.requiresPhp !== '') {
    add(
      'info',
      'requiresAtLeast',
      'Since WordPress 5.8 the directory reads "Requires at least" and "Requires PHP" from the plugin\'s main PHP file header, not from readme.txt. These lines are informational.',
      HANDBOOK,
    );
  }

  // R5 — tested up to: numbers, and the directory ignores minor versions.
  if (doc.testedUpTo !== '' && !VERSION_RE.test(doc.testedUpTo)) {
    add('error', 'testedUpTo', `"${doc.testedUpTo}" is not a version number.`, HANDBOOK);
  } else if (doc.testedUpTo.split('.').length > 2) {
    add('warn', 'testedUpTo', `"${doc.testedUpTo}" includes a minor version. The directory ignores minor versions — use the major one only.`, HANDBOOK);
  }

  // R6 — stable tag.
  if (doc.stableTag === '') {
    add('warn', 'stableTag', 'No stable tag. Without it the directory may not serve the correct version.', HANDBOOK);
  } else if (doc.stableTag.toLowerCase() === 'trunk') {
    add('warn', 'stableTag', '"trunk" is discouraged and prohibited for new plugins.', HANDBOOK);
  } else if (!VERSION_RE.test(doc.stableTag)) {
    add('error', 'stableTag', `"${doc.stableTag}" is not a version number. Use numbers and periods, e.g. "1.2.3".`, HANDBOOK);
  }

  // R7 — the silent killer: stable tag must match the version in the plugin header.
  const headerVersion = options.pluginHeaderVersion?.trim();
  if (headerVersion !== undefined && headerVersion !== '' && doc.stableTag !== '' && doc.stableTag.toLowerCase() !== 'trunk') {
    if (headerVersion !== doc.stableTag) {
      add(
        'error',
        'stableTag',
        `Stable tag is "${doc.stableTag}" but the plugin header says "${headerVersion}". The directory serves the listing from /tags/${doc.stableTag}/ while the page shows "${headerVersion}" — a mismatch ships the wrong thing.`,
        HANDBOOK,
      );
    }
  }

  // R8 — contributors must be WordPress.org usernames.
  for (const contributor of doc.contributors) {
    if (contributor.includes('@') || contributor.includes('http') || /\s/.test(contributor)) {
      add('warn', 'contributors', `"${contributor}" does not look like a WordPress.org username. Use the username only — anything else renders without a profile link.`, HANDBOOK);
    }
  }

  // R9 — URL fields. Markdown link syntax gets its own message: it is a real
  // mistake seen in the wild (Autoptimize's readme has one in License URI) and
  // "not a URL" would be a confusing way to describe it.
  const urlProblem = (value: string): string => {
    if (/^\[[^\]]*\]\([^)]*\)$/.test(value.trim())) {
      return `"${value}" is Markdown link syntax. This field must be a bare absolute URL.`;
    }
    return `"${value}" is not an absolute http(s) URL.`;
  };
  if (doc.donateLink !== '' && !isUrl(doc.donateLink)) {
    add('error', 'donateLink', urlProblem(doc.donateLink), HANDBOOK);
  }
  if (doc.licenseUri !== '' && !isUrl(doc.licenseUri)) {
    add('error', 'licenseUri', urlProblem(doc.licenseUri), HANDBOOK);
  }
  if (doc.license === '') {
    add('info', 'license', 'No license set. The directory expects a GPLv2-or-later compatible license.', HANDBOOK);
  }

  // R10 — file size.
  const rendered = options.readmeText ?? buildReadme(doc);
  const bytes = utf8Bytes(rendered);
  if (bytes > MAX_README_BYTES) {
    add('warn', 'readme', `readme.txt is ${Math.round(bytes / 1024)} KB. The directory can error above 10 KB — move the old changelog into changelog.txt.`, HANDBOOK);
  }

  // R11 — description.
  if (doc.sections.description.trim() === '') {
    add('info', 'description', 'No Description section. The directory falls back to the short description, which reads poorly on the listing.', HANDBOOK);
  }

  // R12 — upgrade notice length.
  for (const notice of doc.sections.upgradeNotice) {
    if (notice.text.length > 300) {
      add('warn', 'upgradeNotice', `Upgrade notice for ${notice.version} is ${notice.text.length} characters; the limit is 300.`, HANDBOOK);
    }
  }

  // R13 — changelog ordering.
  const versions = doc.sections.changelog.map((entry) => entry.version);
  for (let i = 1; i < versions.length; i += 1) {
    const previous = versions[i - 1] ?? '';
    const next = versions[i] ?? '';
    if (VERSION_RE.test(previous) && VERSION_RE.test(next) && compareVersions(previous, next) < 0) {
      add('info', 'changelog', `Changelog lists ${previous} before ${next}. Newest version goes first.`, HANDBOOK);
      break;
    }
  }

  // R14 — screenshot captions are the only place the directory gets captions.
  if (doc.sections.screenshots.length > 0) {
    add(
      'info',
      'screenshots',
      `${doc.sections.screenshots.length} screenshot caption(s). Matching screenshot-1.png, screenshot-2.png … files must exist in /assets/ — readme.txt does not carry the images.`,
      ASSETS,
    );
  }

  return found;
}
