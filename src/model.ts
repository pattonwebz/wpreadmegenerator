/**
 * The readme document model.
 *
 * Every other module is a pure function over this shape: `build` renders it,
 * `parse` produces it, `validate` inspects it. Nothing here knows about the
 * DOM, the filesystem or the network.
 */

export interface FaqItem {
  q: string;
  a: string;
}

export interface ChangelogEntry {
  version: string;
  entries: string[];
}

export interface UpgradeNoticeEntry {
  version: string;
  text: string;
}

export interface CustomSection {
  title: string;
  body: string;
}

export interface ReadmeSections {
  description: string;
  installation: string;
  faq: FaqItem[];
  screenshots: string[];
  changelog: ChangelogEntry[];
  upgradeNotice: UpgradeNoticeEntry[];
  custom: CustomSection[];
}

export interface ReadmeDoc {
  pluginName: string;
  contributors: string[];
  donateLink: string;
  tags: string[];
  requiresAtLeast: string;
  testedUpTo: string;
  stableTag: string;
  requiresPhp: string;
  license: string;
  licenseUri: string;
  shortDescription: string;
  /**
   * Header lines this model does not understand, kept verbatim so an
   * import/export cycle never silently drops a plugin author's field.
   */
  unparsedHeaders: string[];
  sections: ReadmeSections;
}

export type Severity = 'error' | 'warn' | 'info';

export interface Finding {
  level: Severity;
  field: string;
  message: string;
  /** Handbook URL fragment or short citation for this rule. */
  source: string;
}

export function emptySections(): ReadmeSections {
  return {
    description: '',
    installation: '',
    faq: [],
    screenshots: [],
    changelog: [],
    upgradeNotice: [],
    custom: [],
  };
}

export function emptyDoc(): ReadmeDoc {
  return {
    pluginName: '',
    contributors: [],
    donateLink: '',
    tags: [],
    requiresAtLeast: '',
    testedUpTo: '',
    stableTag: '',
    requiresPhp: '',
    license: '',
    licenseUri: '',
    shortDescription: '',
    unparsedHeaders: [],
    sections: emptySections(),
  };
}

/**
 * Strip leading and trailing blank lines, but keep every remaining line exactly
 * as written. `String.prototype.trim()` is wrong here: readmes use indented
 * blocks (UpdraftPlus's License section is a four-space-indented code block) and
 * trimming the first line's indentation silently corrupts them.
 */
export function trimBlankLines(value: string): string {
  const lines = value.replace(/\r\n?/g, '\n').split('\n');
  let start = 0;
  let end = lines.length;
  while (start < end && (lines[start] ?? '').trim() === '') start += 1;
  while (end > start && (lines[end - 1] ?? '').trim() === '') end -= 1;
  return lines.slice(start, end).join('\n');
}
