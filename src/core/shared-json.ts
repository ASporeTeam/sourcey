/**
 * JSON that keeps shared objects shared. A normalized operation names one
 * type in many places; plain JSON writes it out at every one, which made one
 * request body's console data 2.2 MB of copies of the same 170 KB. Here an
 * object used more than once is written once, in `shared`, and named by its
 * place there, `{"$":n}`, wherever it recurs. A key of the data's own that
 * starts with `$` is written with one `$` more, so no data reads as a name.
 */
export function stringifyShared(value: unknown): string {
  const uses = new Map<object, number>();
  (function count(node: unknown): void {
    if (!node || typeof node !== "object") return;
    const seen = uses.get(node) ?? 0;
    uses.set(node, seen + 1);
    if (!seen) for (const child of Object.values(node)) count(child);
  })(value);
  const places = new Map<object, number>(), shared: unknown[] = [];
  function encode(node: unknown): unknown {
    if (!node || typeof node !== "object") return node;
    if (uses.get(node)! > 1) {
      let place = places.get(node);
      if (place === undefined) {
        places.set(node, (place = shared.length));
        shared.push(undefined);
        shared[place] = written(node);
      }
      return { $: place };
    }
    return written(node);
  }
  function written(node: object): unknown {
    if (Array.isArray(node)) return node.map(encode);
    return Object.fromEntries(Object.entries(node).map(([key, child]) => [key.startsWith("$") ? `$${key}` : key, encode(child)]));
  }
  const root = encode(value);
  return JSON.stringify({ shared, value: root });
}

/** The value `stringifyShared` wrote, its shared objects shared again. */
export function parseShared<T>(text: string): T {
  const { shared, value } = JSON.parse(text) as { shared: unknown[]; value: unknown };
  const made: (object | undefined)[] = [];
  const isName = (node: object): node is { $: number } => {
    const keys = Object.keys(node);
    return keys.length === 1 && keys[0] === "$";
  };
  function decode(node: unknown): unknown {
    if (!node || typeof node !== "object") return node;
    if (!Array.isArray(node) && isName(node)) return named(node.$);
    return filled(Array.isArray(node) ? [] : {}, node);
  }
  function named(place: number): object {
    let object = made[place];
    if (object) return object;
    // Made before it is filled, so an object that reaches itself is the same object.
    made[place] = object = Array.isArray(shared[place]) ? [] : {};
    return filled(object, shared[place] as object);
  }
  function filled(target: object, source: object): object {
    if (Array.isArray(source)) (target as unknown[]).push(...source.map(decode));
    else for (const [key, child] of Object.entries(source)) (target as Record<string, unknown>)[key.startsWith("$$") ? key.slice(1) : key] = decode(child);
    return target;
  }
  return decode(value) as T;
}
