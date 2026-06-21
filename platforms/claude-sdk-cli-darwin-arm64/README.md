# @shellicar/claude-sdk-cli-darwin-arm64

The macOS arm64 prebuilt binary for [`@shellicar/claude-sdk-cli`](https://www.npmjs.com/package/@shellicar/claude-sdk-cli).

This package is not meant to be installed directly. It is an optional dependency of `@shellicar/claude-sdk-cli`, which selects the matching binary for your platform at install time. Install the CLI instead:

```sh
npm i -g @shellicar/claude-sdk-cli@beta
```

The binary is a Node Single Executable Application: it bundles its own Node runtime so the CLI's `node:sqlite` store runs regardless of which Node version your shell resolves.
