import versionInfo from '@shellicar/build-version/version';

type Log = (msg: string) => void;

export function printVersion(log: Log): void {
  log(versionInfo.version);
}

export function printVersionInfo(log: Log): void {
  log(`claude-cli ${versionInfo.version}`);
  log(`  branch:     ${versionInfo.branch}`);
  log(`  sha:        ${versionInfo.sha}`);
  log(`  shortSha:   ${versionInfo.shortSha}`);
  log(`  commitDate: ${versionInfo.commitDate}`);
  log(`  buildDate:  ${versionInfo.buildDate}`);
}

export function printUsage(log: Log): void {
  log(`claude-cli ${versionInfo.version}`);
  log('');
  log('Usage: claude-cli [options]');
  log('');
  log('Options:');
  log('  -v, --version      Show version');
  log('  --version-info     Show detailed version information');
  log('  -h, --help, -?     Show this help message');
  log('  --init-config      Create default config at ~/.claude/cli-config.json');
}

export function printHelp(log: Log): void {
  log('Commands:');
  log('  /version              Show version information');
  log('  /help                 Show available commands');
  log('  /session [id]         Show or switch session');
  log('  /compact-at <uuid>    Compact at a specific message');
  log('  /add-dir <path>       Add an additional directory');
  log('  /quit, /exit          Exit the CLI');
  log('');
  log('Controls:');
  log('  Enter                 New line');
  log('  Ctrl+Enter            Send message');
  log('  Ctrl+/                Toggle command mode');
  log('  Escape                Abort current query / exit command mode');
  log('  Ctrl+C                Quit (any time)');
  log('  Ctrl+D                Quit (at prompt)');
  log('');
  log('Command mode (Ctrl+/):');
  log('  i                     Paste image from clipboard');
  log('  d                     Delete selected image');
  log('  Left/Right            Select image');
  log('  Escape                Exit command mode');
}
