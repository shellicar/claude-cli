import type { SipsBridge } from '@shellicar/claude-core/image/SipsBridge';
import type { ILogger } from '@shellicar/claude-core/logging/ILogger';
import type { ToolAttachmentBlock, ToolDefinition } from '@shellicar/claude-sdk';
import type { IScopedProvider } from '@shellicar/core-di';
import type { z } from 'zod';

/** A fake block scope whose `resolve` always returns the given instance, regardless of the
 *  identifier asked for — enough for a tool that resolves exactly one scoped dependency
 *  (e.g. the TS tools' `ITypeScriptService`) from `scope` at call time. */
export function fakeScope(instance: unknown): IScopedProvider {
  return { resolve: () => instance } as unknown as IScopedProvider;
}

/** Test double: sips unavailable, so ReadFile images pass through unconditioned. */
export const passthroughSips: SipsBridge = {
  dimensions: () => Promise.reject(new Error('no sips in tests')),
  resizeToPng: () => Promise.reject(new Error('no sips in tests')),
};

/** Test double: a logger that discards everything, so the tool builds without the app's logger. */
export const noopLogger: ILogger = { trace: () => {}, debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

export async function call<T extends z.ZodType, TOut extends z.ZodType>(tool: ToolDefinition<T, TOut>, input: z.input<T>, scope?: IScopedProvider): Promise<z.output<TOut>> {
  const { textContent } = await tool.handler(tool.input_schema.parse(input), undefined, scope);
  return textContent;
}

export async function callFull<T extends z.ZodType, TOut extends z.ZodType>(tool: ToolDefinition<T, TOut>, input: z.input<T>): Promise<{ textContent: z.output<TOut>; attachments?: ToolAttachmentBlock[] }> {
  return tool.handler(tool.input_schema.parse(input));
}

/** Drive a composable stage/source `run` directly with a canonical (model fields + the `input` stream).
 *  The canonical's exact shape varies per tool, so it is passed loosely here — in production the Pipe
 *  builds it via `reconcile`. */
export function runStage<O>(tool: { run: (canonical: never) => Promise<O> }, canonical: object): Promise<O> {
  return tool.run(canonical as never);
}
