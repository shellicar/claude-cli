export const ShellicarMcpServerName = 'shellicar';
export const ShellicarExecToolName = 'exec';
export const ShellicarFullExecName = `mcp__${ShellicarMcpServerName}__${ShellicarExecToolName}`;

export const ShellicarExecDescription = `Use this instead of the \`Bash\` tool.
Execute commands with structured input. No shell syntax needed.

Each command is specified as { program, args[] } — no quoting, no escaping.
Use stdin field instead of heredocs. Use redirect for output redirection.
Multiple commands go in steps[] with chaining control (bail_on_error, sequential, independent).
Pipelines connect commands via stdout→stdin.

Examples:
- Single: { steps: [{ type: "command", program: "git", args: ["status"] }] }
- Chained: { steps: [{ type: "command", program: "pnpm", args: ["build"] }, { type: "command", program: "pnpm", args: ["test"] }], chaining: "bail_on_error" }
- Pipeline: { steps: [{ type: "pipeline", commands: [{ program: "grep", args: ["-r", "TODO", "src/"] }, { program: "wc", args: ["-l"] }] }] }
- Stdin: { steps: [{ type: "command", program: "node", args: ["script.js"], stdin: "input data" }] }
- Redirect: { steps: [{ type: "command", program: "curl", args: ["-s", "https://api.example.com"], redirect: { path: "/tmp/out.json" } }] }`;
