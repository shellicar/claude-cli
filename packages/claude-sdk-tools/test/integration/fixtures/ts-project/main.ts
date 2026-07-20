import { Greeter } from './greeter';

const greeter = new Greeter('Hello');
const message = greeter.greet('World');

// A standalone variable with no references
const _unused = 42;

// biome-ignore lint/suspicious/noConsole: test fixture
console.log(message);
