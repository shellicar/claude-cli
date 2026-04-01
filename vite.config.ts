import { defineConfig } from 'vite-plus';

export default defineConfig({
  fmt: {
    ignorePatterns: ['schema/cli-config.schema.json'],
    printWidth: 320,
    tabWidth: 2,
    endOfLine: 'lf',
    singleQuote: true,
    semi: true,
    arrowParens: 'always',
    bracketSpacing: true,
    bracketSameLine: true,
    trailingComma: 'all',
    quoteProps: 'as-needed',
  },
  lint: { options: { typeAware: true, typeCheck: true } },
  staged: {
    '*': 'vp check --fix',
  },
  test: {
    projects: ['packages/*'],
  },
});
