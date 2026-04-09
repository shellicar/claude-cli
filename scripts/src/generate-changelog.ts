import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const RELEASES_BASE = 'https://github.com/shellicar/claude-cli/releases/tag/';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(scriptDir, '..', '..');

const config = JSON.parse(readFileSync(resolve(repoRoot, 'changes.config.json'), 'utf8'));
const categories: Record<string, string> = config.categories;
const categoryOrder = Object.keys(categories);

const packageDir = process.argv[2];
if (!packageDir) {
  console.error('usage: generate-changelog.ts <package-dir>');
  process.exit(1);
}

const absDir = resolve(packageDir);
const pkg = JSON.parse(readFileSync(resolve(absDir, 'package.json'), 'utf8'));
const shortName: string = pkg.name.split('/').pop();

type Entry = { description: string; category: string; metadata?: Record<string, unknown> };
type ReleaseMarker = { type: 'release'; version: string; date: string; tag?: string };
type Group = { entries: Entry[]; release: ReleaseMarker };

const rawLines = readFileSync(resolve(absDir, 'changes.jsonl'), 'utf8')
  .split('\n')
  .filter((l) => l.trim());

const groups: Group[] = [];
let pending: Entry[] = [];

for (const line of rawLines) {
  const obj = JSON.parse(line);
  if (obj.type === 'release') {
    groups.push({ entries: pending, release: obj });
    pending = [];
  } else {
    pending.push(obj);
  }
}
const unreleased = pending;

function tagUrl(release: ReleaseMarker): string {
  const tag = release.tag ?? `${shortName}@${release.version}`;
  return `${RELEASES_BASE}${tag}`;
}

function renderLine(entry: Entry): string {
  let text = entry.description;
  if (entry.metadata?.issue != null) {
    text += ` (#${entry.metadata.issue})`;
  }
  if (typeof entry.metadata?.ghsa === 'string') {
    const ghsa = entry.metadata.ghsa;
    text += ` ([${ghsa}](https://github.com/advisories/${ghsa}))`;
  }
  return `- ${text}`;
}

function renderEntries(entries: Entry[]): string {
  const byCategory: Record<string, Entry[]> = {};
  for (const entry of entries) {
    if (!byCategory[entry.category]) {
      byCategory[entry.category] = [];
    }
    byCategory[entry.category].push(entry);
  }
  return categoryOrder
    .filter((k) => byCategory[k]?.length)
    .map((k) => `### ${categories[k]}\n\n${byCategory[k].map(renderLine).join('\n')}`)
    .join('\n\n');
}

const PREAMBLE = ['', '', 'All notable changes to this project will be documented in this file.', '', 'The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),', 'and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).'].join('\n');

const parts: string[] = [`# Changelog${PREAMBLE}`];

parts.push('\n## [Unreleased]');
if (unreleased.length > 0) {
  parts.push('\n' + renderEntries(unreleased));
}

for (const { entries, release } of groups) {
  parts.push(`\n## [${release.version}] - ${release.date}`);
  if (entries.length > 0) {
    parts.push('\n' + renderEntries(entries));
  }
}

if (groups.length > 0) {
  parts.push('\n' + groups.map((g) => `[${g.release.version}]: ${tagUrl(g.release)}`).join('\n'));
}

const output = parts.join('\n') + '\n';
const changelogPath = resolve(absDir, 'CHANGELOG.md');
writeFileSync(changelogPath, output);
console.log(`wrote ${changelogPath}`);
