import { main } from '../main.js';

try {
  await main();
} catch (err) {
  // biome-ignore lint/suspicious/noConsole: surface a fatal startup error to stderr (the file logger is invisible here)
  console.error(err);
  process.exit(1);
}
