import versionInfo from '@shellicar/build-version/version';

type Log = (msg: string) => void;

export function printVersion(log: Log): void {
  log(versionInfo.version);
}

export function printVersionInfo(log: Log): void {
  log(`claude-sdk-cli ${versionInfo.version}`);
  log(`  branch:     ${versionInfo.branch}`);
  log(`  sha:        ${versionInfo.sha}`);
  log(`  shortSha:   ${versionInfo.shortSha}`);
  log(`  commitDate: ${versionInfo.commitDate}`);
  log(`  buildDate:  ${versionInfo.buildDate}`);
}

export function startupBannerText(): string {
  return `claude-sdk-cli ${versionInfo.version}  ·  build ${versionInfo.buildDate}`;
}

export function printUsage(log: Log): void {
  log(`claude-sdk-cli ${versionInfo.version}`);
  log('');
  log('Usage: claude-sdk-cli [options]');
  log('');
  log('Options:');
  log('  -v, --version      Show version');
  log('  --version-info     Show detailed version information');
  log('  -h, --help, -?     Show this help message');
}
