# @shellicar/mcp-internals

> Private helpers for the claude-cli MCP servers, inlined at build time.

This package is `private: true` and is never published. It is a source-of-truth for MCP helpers, designed to be inlined by any MCP server that uses it: the server bundles the source into its own output, so that server's consumers install no extra dependency. Bundled and published are separate axes: a package can be inlined into a server and, like this one, still never be published.

See the [main documentation](https://github.com/shellicar/claude-cli#readme).
