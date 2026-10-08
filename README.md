# @pattonwebz/wpreadmegenerator

Generate and validate a WordPress.org plugin `readme.txt`.

Zero runtime dependencies. Works as a library, and as a CLI.

## CLI

```
npx @pattonwebz/wpreadmegenerator readme.txt
```

```
usage: wpreadme <readme.txt> [options]

options:
  --plugin-file <file>   read "Version:" from a plugin main file (enables the stable tag check)
  --json                 print findings as JSON
  --fix                  rewrite trivial whitespace problems in place
  -h, --help             show this message

exit codes:
  0  no errors
  1  errors found
  2  usage or IO error
```

`--fix` is conservative and text-level: it normalises line endings, strips trailing whitespace and
collapses runs of blank lines. It never rewrites the file from the parsed model, so nothing is lost.

## Library

```js
import { emptyDoc, buildReadme, parseReadme, validate } from '@pattonwebz/wpreadmegenerator';

const { doc } = parseReadme(readmeText);
const findings = validate(doc, { readmeText, pluginHeaderVersion: '1.2.3' });
const rebuilt = buildReadme(doc);
```

`parseReadme` is tolerant: unknown header lines are preserved verbatim in `doc.unparsedHeaders` and
re-emitted by `buildReadme`, so an import/export cycle never drops a field the model does not know about.

## What it checks

| Rule | Check | Level |
|---|---|---|
| R1 | Short description ≤ 150 characters, no markup | warn |
| R2 | Tags: 1–5 terms | warn |
| R3 | `Requires at least` is numbers and periods only | error |
| R4 | `Requires PHP` is numbers and periods only | error |
| R5 | `Tested up to` names a major version only | warn |
| R6 | `Stable tag` is a version, and not `trunk` | error / warn |
| R7 | `Stable tag` matches `Version:` in the plugin header | error |
| R8 | `Contributors` are WordPress.org usernames | warn |
| R9 | `Donate link` and `License URI` are absolute URLs | error |
| R10 | readme is under 10 KB | warn |
| R11 | `== Description ==` exists | info |
| R12 | Each upgrade notice is ≤ 300 characters | warn |
| R13 | Changelog is newest-first | info |

Two things it tells you that most tools do not:

1. Since **WordPress 5.8** the directory does *not* read `Requires at least` or `Requires PHP` from
   `readme.txt` — it reads them from the plugin's main PHP file header. Those lines are informational.
2. **`Stable tag` decides what ships.** The directory reads it from `/trunk/readme.txt`, then serves the
   listing from `/tags/<stable-tag>/`. The *version* on the page comes from the plugin header, not the
   readme — so a mismatch silently ships the wrong thing. That is rule R7.

## Package budget

"Tiny" is asserted in CI, not aspirational. `ci.yml` fails the build if the tarball exceeds **30 KB**, the
file count exceeds **20**, or the package grows a runtime **dependency**.

Measured on `0.1.0` (arm64, this machine):

| | |
|---|---|
| Stub core + bin, no licence file | 1.6 KB tarball · 3.2 KB unpacked · 4 files |
| Released `0.1.0` | ~16 KB tarball · ~50 KB unpacked · 15 files |
| Of which the GPL-2.0 LICENSE | 18 KB uncompressed — about 81% of the compressed tarball |

Two allowances worth knowing about, because both look like fat and are not:

- **The file count is 15, not the 4–5 a single-file core would have.** TypeScript emits one file per module
  plus a declaration file each, so six modules become twelve files. The earlier budget of 8 assumed a
  single hand-written file.
- **The licence is the single largest thing in the package.** That is correct: GPL-2.0 requires the text to
  travel with the program. It should not be mistaken for bloat later.

For scale, `picocolors` is 6.2 KB unpacked, `shell-quote` 25.7 KB, `semver` 98.7 KB.

## Development

```
npm install
npm test           # builds, then runs the tests against dist/
npm run build      # tsc -> dist/
npm run typecheck
npm run test:stress  # optional: pulls real readmes from the plugin directory and round-trips them
```

Tests are plain JavaScript against the built output, so they exercise exactly what ships.
`test:stress` is opt-in and network-dependent — it fetches ~32 real `readme.txt` files from
`plugins.svn.wordpress.org` and checks that each one parses, round-trips without losing a field, and does
not throw. It is where most of the real bugs were found.

## Licence

GPL-2.0-or-later.
