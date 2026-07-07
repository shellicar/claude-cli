import { z } from 'zod';

/** Meta key marking a schema field as a filesystem path. One constant so declaration and reader agree. */
export const IS_PATH = 'isPath';

/**
 * Meta key marking a field as a nested tool input, keyed by a sibling field that names the tool.
 * Pipe's `steps[].input` carries this so the walker descends into a step's own tool schema — the
 * step paths live in the step tool's schema, not in Pipe's, and this is the seam the walker follows
 * to reach them. `toolInputKeyedBy: 'tool'` means "read the sibling `tool` field, resolve its schema".
 */
export const TOOL_INPUT_KEYED_BY = 'toolInputKeyedBy';

/** A string field whose value IS a filesystem path. `.describe(...)` merges, so the marker survives. */
export const pathSchema = z.string().meta({ [IS_PATH]: true });

/** Resolve a tool name to its input schema, so the walker can descend into a nested tool input. */
export type SchemaResolver = (toolName: string) => z.ZodType | undefined;

// optional/nullable/default wrap the marked type; unwrap so `.meta()` shows the marker.
function unwrap(s: z.ZodType): z.ZodType {
  let c = s;
  while (c instanceof z.ZodOptional || c instanceof z.ZodNullable || c instanceof z.ZodDefault) {
    c = c.unwrap() as z.ZodType;
  }
  return c;
}

function metaOf(s: z.ZodType): Record<string, unknown> | undefined {
  return unwrap(s).meta() as Record<string, unknown> | undefined;
}

const isPathField = (s: z.ZodType): boolean => metaOf(s)?.[IS_PATH] === true;

type ZodDef = {
  type: string;
  innerType: z.ZodType;
  shape: Record<string, z.ZodType>;
  element: z.ZodType;
  options: z.ZodType[];
};

/** A value the walker has confirmed is an indexable container (object or array), viewed for read/replace. */
const asContainer = (v: unknown): Record<string | number, unknown> => v as Record<string | number, unknown>;

/**
 * One walk over the live zod schema. `visit(container, key)` fires at each isPath-marked string slot
 * so a caller reads or replaces it. Recursion follows the schema's own getters (the recursive Exec
 * pipeline resolves through `get left()/get right()`), so there is no JSON Schema, no `$ref` to chase.
 * A field marked with `TOOL_INPUT_KEYED_BY` is a nested tool input: the walk reads the sibling field
 * naming the tool, resolves that tool's schema, and descends — so a Pipe step's paths are reached
 * through the step tool's own schema, keeping the walker generic (it knows "a nested tool input", not
 * "Pipe").
 */
function walkPaths(schema: z.ZodType, value: unknown, visit: (container: Record<string | number, unknown>, key: string | number) => void, resolve?: SchemaResolver): void {
  if (schema == null || value == null) {
    return;
  }
  const def = (schema as unknown as { def: ZodDef }).def;
  switch (def.type) {
    case 'optional':
    case 'nullable':
    case 'default':
      walkPaths(def.innerType, value, visit, resolve);
      return;
    case 'object': {
      if (typeof value !== 'object') {
        return;
      }
      const obj = value as Record<string, unknown>;
      const shape = def.shape;
      for (const key of Object.keys(shape)) {
        const field = shape[key];
        const meta = metaOf(field);
        if (meta?.[IS_PATH] === true) {
          if (typeof obj[key] === 'string') {
            visit(obj, key);
          }
        } else if (typeof meta?.[TOOL_INPUT_KEYED_BY] === 'string') {
          const toolName = obj[meta[TOOL_INPUT_KEYED_BY] as string];
          const nested = typeof toolName === 'string' ? resolve?.(toolName) : undefined;
          if (nested != null) {
            walkPaths(nested, obj[key], visit, resolve);
          }
        } else {
          walkPaths(field, obj[key], visit, resolve);
        }
      }
      return;
    }
    case 'array': {
      if (!Array.isArray(value)) {
        return;
      }
      const el = def.element;
      const marked = isPathField(el);
      for (let i = 0; i < value.length; i++) {
        if (marked) {
          if (typeof value[i] === 'string') {
            visit(asContainer(value), i);
          }
        } else {
          walkPaths(el, value[i], visit, resolve);
        }
      }
      return;
    }
    case 'union':
      for (const opt of def.options) {
        walkPaths(opt, value, visit, resolve);
      }
      return;
  }
}

/** Every isPath value in `input` — for a consumer to READ the (already replaced) field. */
export function collectPaths(schema: z.ZodType, input: unknown, resolve?: SchemaResolver): string[] {
  const out: string[] = [];
  walkPaths(schema, input, (c, k) => out.push(c[k] as string), resolve);
  return out;
}

/** Replace every isPath value in `input`, in place, with `expand(value)`. */
export function normalisePaths(schema: z.ZodType, input: unknown, expand: (p: string) => string, resolve?: SchemaResolver): void {
  walkPaths(
    schema,
    input,
    (c, k) => {
      c[k] = expand(c[k] as string);
    },
    resolve,
  );
}

/**
 * Append `note` to the `description` of every isPath-marked node in a generated JSON schema, so the
 * model reading the wire schema is told a path field is normalised (the marker alone is opaque to it).
 * Walks the JSON shape generically — property values, array `items`, `anyOf`/`allOf`/`oneOf` branches,
 * and the `definitions`/`$defs` bucket — so a `$ref` needs no resolution: its target is walked in place.
 */
export function annotatePathDescriptions(schema: unknown, note: string): void {
  if (Array.isArray(schema)) {
    for (const item of schema) {
      annotatePathDescriptions(item, note);
    }
    return;
  }
  if (schema == null || typeof schema !== 'object') {
    return;
  }
  const node = schema as Record<string, unknown>;
  if (node[IS_PATH] === true) {
    const existing = typeof node.description === 'string' ? node.description : undefined;
    node.description = existing ? `${existing} ${note}` : note;
  }
  for (const value of Object.values(node)) {
    annotatePathDescriptions(value, note);
  }
}
