#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { parseReadme } from './parse.js';
import { validate } from './validate.js';

const USAGE = `usage: wpreadme <readme.txt> [options]

options:
  --plugin-file <file>   read "Version:" from a plugin main file (enables the stable tag check)
  --json                 print findings as JSON
  --fix                  rewrite trivial whitespace problems in place
  -h, --help             show this message

exit codes:
  0  no errors
  1  errors found
  2  usage or IO error`;

/** Conservative, text-level normalisation. Never rebuilds from the model, so nothing is lost. */
export function normaliseReadme(text: string): string {
  return `${text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/\n+$/, '')}\n`;
}

function pluginHeaderVersion(source: string): string | undefined {
  const match = /^[ \t*]*Version:[ \t]*(.+)$/m.exec(source);
  return match === null ? undefined : (match[1] ?? '').trim();
}

function main(argv: string[]): number {
  let values: {
    json?: boolean;
    fix?: boolean;
    help?: boolean;
    'plugin-file'?: string;
  };
  let positionals: string[];

  try {
    const parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        json: { type: 'boolean', default: false },
        fix: { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
        'plugin-file': { type: 'string' },
      },
    });
    values = parsed.values;
    positionals = parsed.positionals;
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n\n${USAGE}\n`);
    return 2;
  }

  if (values.help === true) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }

  const target = positionals[0];
  if (target === undefined) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }

  let text: string;
  try {
    text = readFileSync(target, 'utf8');
  } catch (error) {
    process.stderr.write(`wpreadme: cannot read ${target}: ${(error as Error).message}\n`);
    return 2;
  }

  let headerVersion: string | undefined;
  if (values['plugin-file'] !== undefined) {
    try {
      headerVersion = pluginHeaderVersion(readFileSync(values['plugin-file'], 'utf8'));
    } catch (error) {
      process.stderr.write(`wpreadme: cannot read ${values['plugin-file']}: ${(error as Error).message}\n`);
      return 2;
    }
    if (headerVersion === undefined) {
      process.stderr.write(`wpreadme: no "Version:" line found in ${values['plugin-file']}\n`);
      return 2;
    }
  }

  const parsed = parseReadme(text);
  const options = headerVersion === undefined
    ? { readmeText: text }
    : { readmeText: text, pluginHeaderVersion: headerVersion };
  const findings = validate(parsed.doc, options);

  if (values.fix === true) {
    const fixed = normaliseReadme(text);
    if (fixed !== text) {
      writeFileSync(target, fixed);
      process.stdout.write(`wpreadme: normalised whitespace in ${target}\n`);
    } else {
      process.stdout.write(`wpreadme: ${target} needed no fixes\n`);
    }
  }

  for (const warning of parsed.warnings) {
    process.stderr.write(`wpreadme: ${warning}\n`);
  }

  if (values.json === true) {
    process.stdout.write(`${JSON.stringify({ findings, warnings: parsed.warnings }, null, 2)}\n`);
  } else {
    for (const finding of findings) {
      process.stdout.write(`${finding.level.padEnd(5)} ${finding.field}: ${finding.message}\n`);
    }
    const errors = findings.filter((finding) => finding.level === 'error').length;
    const warnings = findings.filter((finding) => finding.level === 'warn').length;
    process.stdout.write(`\n${errors} error(s), ${warnings} warning(s), ${findings.length - errors - warnings} note(s)\n`);
  }

  return findings.some((finding) => finding.level === 'error') ? 1 : 0;
}

process.exitCode = main(process.argv.slice(2));
