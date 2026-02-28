import { parseArgs } from 'node:util';
import { ClaudeCli } from './ClaudeCli.js';
import { initConfig } from './cli-config.js';
import { printUsage, printVersion } from './help.js';

const { values } = parseArgs({
  options: {
    version: { type: 'boolean', short: 'v', default: false },
    help: { type: 'boolean', short: 'h', default: false },
    'init-config': { type: 'boolean', default: false },
  },
  strict: false,
});

if (values.version) {
  // biome-ignore lint/suspicious/noConsole: CLI --version output before app starts
  printVersion(console.log);
  process.exit(0);
}

if (values.help || process.argv.includes('-?')) {
  // biome-ignore lint/suspicious/noConsole: CLI --help output before app starts
  printUsage(console.log);
  process.exit(0);
}

if (values['init-config']) {
  // biome-ignore lint/suspicious/noConsole: CLI --init-config output before app starts
  initConfig(console.log);
  process.exit(0);
}

const cli = new ClaudeCli();
await cli.start();
