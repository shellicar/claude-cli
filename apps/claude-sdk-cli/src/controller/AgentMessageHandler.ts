import { relative } from 'node:path';
import { RESET } from '@shellicar/claude-core/ansi';
import { ConfigLoader } from '@shellicar/claude-core/Config/ConfigLoader';
import { IFileSystem } from '@shellicar/claude-core/fs/interfaces';
import { ILogger } from '@shellicar/claude-core/logging/ILogger';
import { type AnyToolDefinition, calculateCostSplit, collectPaths, type DurableConfig, IDurableConfigProvider, type SdkError, type SdkMessage, type SdkMessageUsage, type SdkToolApprovalRequest } from '@shellicar/claude-sdk';
import type { RefStore } from '@shellicar/claude-sdk-tools/RefStore';
import { dependsOn } from '@shellicar/core-di-lite';
import { IApprovalHolder, type Settlement } from '../approval/ApprovalHolder.js';
import { IConvChangePublisher } from '../conv/ConvChangePublisher.js';
import { ApprovalNotifier } from '../model/ApprovalNotifier.js';
import { CONTENT_INDENT } from '../model/blockLayout.js';
import { ConversationSession } from '../model/ConversationSession.js';
import { ConversationState } from '../model/ConversationState.js';
import { CODE_FG } from '../model/markdown/palette.js';
import { StatusState } from '../model/StatusState.js';
import { type PendingTool, ToolApprovalState } from '../model/ToolApprovalState.js';
import { ToolObject } from '../model/ToolObject.js';
import { buildPermissionMatrix, findUnknownTools, getPermission, PermissionAction, type PermissionConfig } from '../permissions.js';
import { AppToolsService } from '../setup/AppToolsService.js';
import { ConsumerChannel } from '../setup/ConsumerChannel.js';

// ---- helpers (unchanged from current branch) ------------------------------------

function fmtBytes(n: number): string {
  if (n >= 1024 * 1024) {
    return `${(n / 1024 / 1024).toFixed(1)}mb`;
  }
  if (n >= 1024) {
    return `${(n / 1024).toFixed(1)}kb`;
  }
  return `${n}b`;
}

/** Renders an SDK error for display. When the SDK carried structured detail (status, API
 * error type, and the body's message), compose a line that names all three; otherwise fall
 * back to the error's plain message. The status/type prefix is dropped when neither is
 * present, so a detail carrying only a message reads as that message alone. */
function formatSdkError(msg: SdkError): string {
  const detail = msg.detail;
  if (detail == null) {
    return msg.message;
  }
  const prefix = [detail.status != null ? `HTTP ${detail.status}` : undefined, detail.type].filter((part) => part != null).join(' ');
  return prefix.length > 0 ? `${prefix}: ${detail.message}` : detail.message;
}

// The display arg: the marked path (already replaced in place by the SDK, shown relative to cwd), or
// a non-path label. `schema` locates the marked field via collectPaths — no hardcoded key-list. The
// url/query/pattern/intent fallbacks are display-only labels, not paths, so they stay inline.
function displayArg(input: Record<string, unknown>, cwd: string, schema: AnyToolDefinition['input_schema'] | undefined): string | null {
  const paths = schema ? collectPaths(schema, input) : [];
  if (paths.length > 0) {
    return relative(cwd, paths[0]) || paths[0];
  }
  if (typeof input.url === 'string') {
    return input.url;
  }
  if (typeof input.query === 'string') {
    return input.query;
  }
  if (typeof input.pattern === 'string') {
    return input.pattern;
  }
  if (typeof input.intent === 'string') {
    return input.intent;
  }
  return null;
}

function formatRefSummary(input: Record<string, unknown>, store: RefStore): string {
  const id = typeof input.id === 'string' ? input.id : '';
  if (!id) {
    return 'Ref(?)';
  }
  const hint = store.getHint(id) ?? id.slice(0, 8);
  const content = store.get(id);
  if (content === undefined) {
    return `Ref(${id.slice(0, 8)}\u2026)`;
  }
  const sizeStr = fmtBytes(content.length);
  const start = typeof input.start === 'number' ? input.start : 0;
  const limit = typeof input.limit === 'number' ? input.limit : 1000;
  const end = Math.min(start + limit, content.length);
  return `Ref \u2190 ${hint} [${start}\u2013${end} / ${sizeStr}]`;
}

export const MEMORY_TOOLS = new Set(['WriteMemory', 'ReadMemory', 'SearchMemory', 'DeleteMemory', 'MemoryTypes']);

export function formatMemorySummary(name: string, input: Record<string, unknown>): string {
  const desc = typeof input.intent === 'string' ? input.intent : '';
  const head = desc ? `${name}: ${desc}` : name;
  if (name === 'WriteMemory') {
    const title = typeof input.title === 'string' ? input.title : '';
    const type = typeof input.type === 'string' ? input.type : '';
    const len = typeof input.body === 'string' ? input.body.length : 0;
    return `${head} \u2014 "${title}" [${type}, ${len} chars]`;
  }
  if (name === 'SearchMemory') {
    const query = typeof input.query === 'string' ? input.query : '';
    const type = typeof input.type === 'string' ? ` \u00b7 ${input.type}` : '';
    return `${head} \u2014 "${query}"${type}`;
  }
  if (name === 'ReadMemory' || name === 'DeleteMemory') {
    const id = typeof input.id === 'string' ? input.id : '';
    return `${head} \u2014 ${id}`;
  }
  return head; // MemoryTypes — intent is optional and may be absent
}

/** SearchMemory's result-derived line: hit count and the top result's title. Parses the post-transform tool_result content. Returns null for non-search tools or unparseable content. */
export function formatMemoryResult(name: string, content: string): string | null {
  if (name !== 'SearchMemory') {
    return null;
  }
  try {
    const parsed = JSON.parse(content) as { count?: number; results?: Array<{ title?: string }> };
    const count = parsed.count ?? 0;
    const top = parsed.results?.[0]?.title;
    return top ? `${count} hits \u00b7 "${top}"` : `${count} hits`;
  } catch {
    return null;
  }
}

function formatToolSummary(name: string, input: Record<string, unknown>, cwd: string, store: RefStore, resolveSchema: (toolName: string) => AnyToolDefinition['input_schema'] | undefined): string {
  if (MEMORY_TOOLS.has(name)) {
    return formatMemorySummary(name, input);
  }
  if (name === 'Ref') {
    return formatRefSummary(input, store);
  }
  if (name === 'Pipe' && Array.isArray(input.steps)) {
    const steps = (input.steps as Array<{ tool?: unknown; input?: unknown }>)
      .map((s) => {
        const tool = typeof s.tool === 'string' ? s.tool : '?';
        const stepInput = s.input != null && typeof s.input === 'object' ? (s.input as Record<string, unknown>) : {};
        const arg = displayArg(stepInput, cwd, resolveSchema(tool));
        return arg ? `${tool}(${arg})` : tool;
      })
      .join(' | ');
    return steps;
  }
  if (name === 'Skill' && typeof input.skill === 'string') {
    return `Skill(${input.skill})`;
  }
  const arg = displayArg(input, cwd, resolveSchema(name));
  return arg ? `${name}(${arg})` : name;
}

// ---- class ---------------------------------------------------------------

/**
 * Block type mapping from raw Anthropic API content block types to the visual
 * block types used by ConversationState. Returns null for types that have no
 * visual representation (server tool results, unknown types).
 */
// Maps API content block types to visual block types for non-tool blocks.
// tool_use and server_tool_use are handled by tool_batch_start/end, not block_enter/exit.
function toVisualBlockType(apiType: string): 'thinking' | 'response' | 'compaction' | null {
  switch (apiType) {
    case 'text':
      return 'response';
    case 'thinking':
      return 'thinking';
    case 'compaction':
      return 'compaction';
    default:
      return null;
  }
}

/**
 * Handles all SdkMessage cases: routes each message to the appropriate
 * state mutation or channel send.
 *
 * Block lifecycle is driven by explicit block_enter / block_exit events from
 * the SDK (mapped from the API's content_block_start / content_block_stop).
 * Delta events (message_text, message_thinking, etc.) append to the already-
 * open block without opening one themselves. The tools visual block spans the
 * full tool-use phase of a turn and is sealed by message_usage.
 */
export class AgentMessageHandler {
  @dependsOn(ILogger) private readonly logger!: ILogger;
  @dependsOn(IDurableConfigProvider) private readonly durableProvider!: IDurableConfigProvider;
  @dependsOn(ConsumerChannel) private readonly channel!: ConsumerChannel;
  @dependsOn(AppToolsService) private readonly appTools!: AppToolsService;
  @dependsOn(StatusState) private readonly statusState!: StatusState;
  @dependsOn(ApprovalNotifier) private readonly notifier!: ApprovalNotifier;
  @dependsOn(ConversationState) private readonly conversation!: ConversationState;
  @dependsOn(ConversationSession) private readonly session!: ConversationSession;
  @dependsOn(ToolApprovalState) private readonly tools!: ToolApprovalState;
  @dependsOn(ConfigLoader) private readonly configLoader!: ConfigLoader<any>;
  @dependsOn(IFileSystem) private readonly fs!: IFileSystem;
  @dependsOn(IApprovalHolder) private readonly approvalHolder!: IApprovalHolder;
  @dependsOn(IConvChangePublisher) private readonly convChanges!: IConvChangePublisher;
  #lastUsage: SdkMessageUsage | null = null;
  #toolObjects = new Map<string, ToolObject>();
  #toolOrder: string[] = [];
  #toolAnnotation = '';

  // Current durable config, derived fresh on each read by the provider.
  get #config(): DurableConfig {
    return this.durableProvider.config;
  }

  // Cheap derivation, cannot fail.
  get #cwd(): string {
    return this.fs.cwd();
  }

  get #store(): RefStore {
    return this.appTools.store;
  }

  #getMatrix(): PermissionConfig {
    return buildPermissionMatrix(this.configLoader.config.permissions);
  }

  // Locate a tool's input schema for the display's marked-path lookup. Only top-level tools reach
  // display here; a pipe step's Find/Paths schema is among them, and a stage step (no path field)
  // resolves to undefined, falling through to the url/query/pattern/intent label.
  #schemaFor = (name: string): AnyToolDefinition['input_schema'] | undefined => this.appTools.tools.find((t) => t.name === name)?.input_schema;

  public handle(msg: SdkMessage): void {
    switch (msg.type) {
      case 'query_summary': {
        // Send-time persistence. query_summary is published once per turn, right
        // before the interruptible request, after the user message that opens the
        // turn is already in the conversation — the end-human message at query
        // start, or the previous turn's tool_result. Saving here means a death
        // mid-response still leaves the sent user message on disk, so
        // submit-to-resume can recover it after a restart. Same fire-and-forget
        // contract as the after-assistant save (cf. known debt #1).
        void this.session
          .saveConversation()
          .then(() => this.convChanges.flush(this.session.id))
          .catch((err) => this.logger.error('persist on send failed', { error: String(err) }));
        const parts = [`${msg.systemPrompts} system`, `${msg.userMessages} user`, `${msg.assistantMessages} assistant`, ...(msg.thinkingBlocks > 0 ? [`${msg.thinkingBlocks} thinking`] : [])];
        this.conversation.transitionBlock('meta');
        const deltaLine = msg.systemReminder ? `\n${msg.systemReminder}` : '';
        this.conversation.appendStreaming(`\uD83E\uDD16 ${this.#config.model}\n${parts.join(' \u00b7 ')}${deltaLine}`);
        break;
      }
      case 'tool_batch_start':
        // The SDK guarantees this fires once per message, before the first tool_use block.
        // Open the visual tools block and reset all per-batch state.
        this.conversation.transitionBlock('tools');
        this.#toolObjects = new Map();
        this.#toolOrder = [];
        this.#toolAnnotation = '';
        break;
      case 'tool_batch_end':
        // stop_reason === 'tool_use' has fired. The tool-use (generation) block is
        // sealed by message_usage; execution is a separate block opened by tool_exec_start.
        break;
      case 'tool_exec_start':
        // The assistant message and its usage are done; the batch is now running.
        // Open the execution block so its createdAt→exitedAt spans the real run
        // (approval waits included), distinct from the generation span the use block times.
        this.conversation.transitionBlock('execution');
        this.#redrawTools();
        break;
      case 'tool_exec_end':
        // Every tool in the batch has settled — seal the execution block.
        this.conversation.completeActive();
        break;
      case 'block_enter': {
        // tool_use/server_tool_use lifecycle is managed by tool_batch_start/end.
        const visual = toVisualBlockType(msg.blockType);
        if (visual !== null) {
          this.conversation.transitionBlock(visual);
        }
        break;
      }
      case 'block_exit': {
        const visual = toVisualBlockType(msg.blockType);
        if (visual !== null) {
          this.conversation.completeActive();
        }
        break;
      }
      case 'message_thinking':
        this.conversation.appendStreaming(msg.text);
        break;
      case 'message_text':
        this.conversation.appendStreaming(msg.text);
        break;
      case 'message_compaction': {
        this.conversation.appendStreaming(msg.summary);
        if (this.#lastUsage) {
          const used = this.#lastUsage.inputTokens + this.#lastUsage.cacheCreationTokens + this.#lastUsage.cacheReadTokens;
          const pct = ((used / this.#lastUsage.contextWindow) * 100).toFixed(1);
          const fmt = (n: number) => (n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
          this.conversation.appendStreaming(`\n\n[compacted at ${fmt(used)} / ${fmt(this.#lastUsage.contextWindow)} (${pct}%)]`);
        }
        break;
      }
      case 'server_tool_use': {
        this.logger.debug('server_tool_use', { id: msg.id, name: msg.name });
        const obj = this.#toolObjects.get(msg.id);
        if (obj) {
          obj.resolve(formatToolSummary(msg.name, msg.input, this.#cwd, this.#store, this.#schemaFor));
          obj.setInput(msg.input);
          // emit drives #redrawTools
        }
        break;
      }
      case 'server_tool_result':
        this.#toolObjects.get(msg.id)?.complete();
        this.#toolObjects.get(msg.id)?.setOutput(typeof msg.result === 'string' ? msg.result : JSON.stringify(msg.result));
        // emit drives #redrawTools
        break;
      case 'tool_result': {
        this.#toolObjects.get(msg.id)?.setOutput(msg.content);
        const obj = this.#toolObjects.get(msg.id);
        if (obj) {
          const line = formatMemoryResult(obj.name, msg.content);
          if (line !== null) {
            obj.setResultLine(line);
          }
        }
        // emit drives #redrawTools
        break;
      }
      case 'tool_use_start': {
        // block_enter('tool_use') already opened the visual tools block.
        const clientObj = new ToolObject(msg.id, 'client', msg.name);
        clientObj.on('change', () => this.#redrawTools());
        this.#toolObjects.set(msg.id, clientObj);
        this.#toolOrder.push(msg.id);
        this.#redrawTools(); // show initial streaming state before first delta
        break;
      }
      case 'server_tool_use_start': {
        // block_enter('server_tool_use') already opened the visual tools block.
        this.logger.info('server_tool_use_start', { id: msg.id, name: msg.name });
        const serverObj = new ToolObject(msg.id, 'server', msg.name);
        serverObj.on('change', () => this.#redrawTools());
        this.#toolObjects.set(msg.id, serverObj);
        this.#toolOrder.push(msg.id);
        this.#redrawTools(); // show initial streaming state
        break;
      }
      case 'tool_use_input_delta':
        this.#toolObjects.get(msg.id)?.appendInput(msg.partialJson);
        // emit drives #redrawTools
        break;
      case 'tool_use_input_stop': {
        // The input block is complete and the SDK has parsed it. Flip the tool from the
        // raw streamed JSON to its resolved view now.
        const obj = this.#toolObjects.get(msg.id);
        if (obj) {
          obj.resolve(formatToolSummary(obj.name, msg.input, this.#cwd, this.#store, this.#schemaFor));
          obj.setInput(msg.input);
          // emit drives #redrawTools
        }
        break;
      }
      case 'tool_approval_request': {
        // No block transition needed — tools block already exists (active or sealed).
        // ToolObject.resolve() emits change which drives #redrawTools via setLastContent.
        const approvalObj = this.#toolObjects.get(msg.requestId) ?? null;
        if (approvalObj) {
          approvalObj.resolve(formatToolSummary(msg.name, msg.input, this.#cwd, this.#store, this.#schemaFor));
          // emit drives #redrawTools
        }
        void this.#toolApprovalRequest(msg, approvalObj);
        break;
      }
      case 'tool_error':
        // Error during tool dispatch — no active block at this point, appendStreaming
        // opens a notice block so the error lands visibly without a new tools block.
        this.conversation.appendStreaming(`${msg.name} error\n\`\`\`json\n${JSON.stringify(msg.input, null, 2)}\n\`\`\`\n\n${msg.error}\n`);
        break;
      case 'message_usage': {
        // The API reports usage in frames across a turn: input + cache land on message_start, output at
        // message_end. Each frame is priced on its own, so the per-turn token line splits in two — the
        // context frame at the start, the output frame at the end — rather than one lump on the tools block.
        const context = msg.inputTokens + msg.cacheCreationTokens + msg.cacheReadTokens;
        if (context > 0) {
          // Context frame. Show the growth over the previous turn's context, priced as the marginal new
          // input/cache (the running calc). #lastUsage tracks the context frame, never the output frame.
          const prev = this.#lastUsage;
          const prevCtx = prev ? prev.inputTokens + prev.cacheCreationTokens + prev.cacheReadTokens : 0;
          const delta = context - prevCtx;
          const sign = delta >= 0 ? '+' : '';
          const marginalCost = calculateCostSplit(
            {
              inputTokens: Math.max(0, msg.inputTokens - (prev?.inputTokens ?? 0)),
              cacheCreation5mTokens: Math.max(0, msg.cacheCreation5mTokens - (prev?.cacheCreation5mTokens ?? 0)),
              cacheCreation1hTokens: Math.max(0, msg.cacheCreation1hTokens - (prev?.cacheCreation1hTokens ?? 0)),
              cacheReadTokens: Math.max(0, msg.cacheReadTokens - (prev?.cacheReadTokens ?? 0)),
              outputTokens: 0,
            },
            this.#config.model,
          );
          this.#appendUsageLine(`[\u2191 ${sign}${delta.toLocaleString()} tokens \u00b7 $${marginalCost.toFixed(4)}]`);
          this.#lastUsage = msg;
        } else if (msg.outputTokens > 0) {
          // Output frame. Show the tokens the model produced this turn and their own cost.
          const outputCost = calculateCostSplit({ inputTokens: 0, cacheCreation5mTokens: 0, cacheCreation1hTokens: 0, cacheReadTokens: 0, outputTokens: msg.outputTokens }, this.#config.model);
          this.#appendUsageLine(`[\u2193 +${msg.outputTokens.toLocaleString()} tokens \u00b7 $${outputCost.toFixed(4)}]`);
        }
        this.conversation.completeActive();
        this.statusState.update(msg);
        break;
      }
      case 'done':
        this.logger.info('done', { stopReason: msg.stopReason });
        if (msg.stopReason !== 'end_turn') {
          this.conversation.appendStreaming(`\n\n[stop: ${msg.stopReason}]`);
        }
        break;
      case 'error':
        this.conversation.appendStreaming(`\n\n[error: ${formatSdkError(msg)}]`);
        this.logger.error('error', { message: msg.message, detail: msg.detail });
        break;
      case 'turn_content':
        // Persist after each assistant turn. The assistant content cannot be
        // regenerated, so save it the moment the turn completes (before the next
        // turn's tool round-trip). Fire-and-forget: a persist failure must not
        // interrupt the turn — it is logged, never thrown (cf. known debt #1).
        void this.session
          .saveConversation()
          .then(() => this.convChanges.flush(this.session.id))
          .catch((err) => this.logger.error('persist after turn failed', { error: String(err) }));
        break;
    }
  }

  // Place a per-frame usage line, painted gold. A tools/execution block owns its content through
  // #redrawTools, so the line rides the annotation buffer there; an active meta/response block takes it
  // inline (both already indented). With no active block — the output frame after a plain-text response,
  // whose block is sealed — appendStreaming opens a notice block, which renders flush-left, so the line
  // is hand-indented with CONTENT_INDENT to line up with the other block bodies.
  #appendUsageLine(line: string): void {
    const styled = `${CODE_FG}${line}${RESET}`;
    const type = this.conversation.activeBlock?.type;
    if (type === 'tools' || type === 'execution') {
      this.#toolAnnotation += `${styled}\n`;
      this.#redrawTools();
    } else if (type != null) {
      this.conversation.appendStreaming(`\n${styled}`);
    } else {
      this.conversation.appendStreaming(`${CONTENT_INDENT}${styled}`);
    }
  }

  #redrawTools(): void {
    const content = this.#toolOrder.map((id) => this.#toolObjects.get(id)?.render() ?? '').join('');
    const entries = this.#toolOrder.flatMap((id) => {
      const obj = this.#toolObjects.get(id);
      return obj ? [obj.toEntry()] : [];
    });
    // The tool-use block (generation) carries the token annotation; the execution block
    // carries the run only. Target whichever phase is live: the execution block once it
    // has opened, the use block before that.
    const target = this.conversation.activeBlock?.type === 'execution' ? 'execution' : 'tools';
    const annotation = target === 'tools' ? this.#toolAnnotation : '';
    this.conversation.setLastTools(target, content + annotation, entries);
  }

  async #toolApprovalRequest(msg: SdkToolApprovalRequest, obj: ToolObject | null): Promise<void> {
    try {
      this.logger.info('tool_approval_request', { name: msg.name, input: msg.input });
      const pendingTool: PendingTool = { requestId: msg.requestId, name: msg.name, input: msg.input };
      this.tools.addTool(pendingTool);
      const perm = getPermission({ name: msg.name, input: msg.input }, this.appTools.permissionTools, this.#cwd, this.#getMatrix());
      if (perm === PermissionAction.NotFound) {
        // A lookup failure, not a decision. Tell the model the real cause via `reason` (the SDK
        // forwards it as the tool_result), never the default "Rejected by user" — the user saw
        // no prompt and rejected nothing.
        const missing = findUnknownTools({ name: msg.name, input: msg.input }, this.appTools.permissionTools);
        const reason = `Tool not found: ${missing.join(', ')}. This is a tool-lookup failure, not a user rejection.`;
        this.logger.info('Tool not found', { name: msg.name, missing });
        this.channel.send({ type: 'tool_approval_response', requestId: msg.requestId, approved: false, reason });
        this.tools.removeTool(msg.requestId);
        obj?.error();
        return;
      }
      let approved: boolean;
      if (perm === PermissionAction.Approve) {
        this.logger.info('Auto approving', { name: msg.name });
        approved = true;
      } else if (perm === PermissionAction.Deny) {
        this.logger.info('Auto denying', { name: msg.name });
        approved = false;
      } else {
        // A human actually waits here (auto-approve/auto-deny settle without a prompt, above). Raise the
        // ask on the wire and race the local keypress against a wire answer — first valid answer wins.
        // When the bus is disabled the raise is a zero-effect no-op and only the local keypress can win.
        const tip = this.session.conversationTip();
        const wireAnswer = this.approvalHolder.raise(msg, { conversationId: this.session.id, queryId: tip?.queryId, turnId: tip?.turnId, toolUseId: msg.requestId });
        this.notifier.start(msg);
        const localAnswer = this.tools.requestApproval(msg.requestId).then((a): Settlement => ({ approved: a, by: { kind: 'human' } }));
        const settlement = await Promise.race([localAnswer, wireAnswer]);
        approved = settlement.approved;
        this.approvalHolder.settle(msg.requestId, settlement); // idempotent — the local path's later settle is a no-op
        // Drain THIS tool's own local promise by its id. If the wire won, the queued
        // local promise is settled here; if the keypress won, this is a no-op. It never
        // touches a sibling tool's pending approval — the batch-collapse bug.
        this.tools.resolveApproval(msg.requestId, settlement.approved);
        this.notifier.cancel();
      }
      this.channel.send({ type: 'tool_approval_response', requestId: msg.requestId, approved });
      this.tools.removeTool(msg.requestId);
      if (approved) {
        obj?.approve();
      } else {
        obj?.deny();
      }
      // emit drives #redrawTools
    } catch (err) {
      this.logger.error('Error', err);
      this.channel.send({ type: 'tool_approval_response', requestId: msg.requestId, approved: false });
      this.tools.removeTool(msg.requestId);
      obj?.error();
      // emit drives #redrawTools
    }
  }
}
