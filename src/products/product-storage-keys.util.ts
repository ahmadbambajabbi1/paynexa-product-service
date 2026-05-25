/** Collect `product_images/…` keys from JSON stored on Product (arrays, nested attributes). */
export function collectProductImageKeysDeep(
  node: unknown,
  out: Set<string>,
): void {
  if (typeof node === 'string') {
    if (/^product_images\/[a-zA-Z0-9._/-]+$/.test(node)) {
      out.add(node);
    }
    return;
  }
  if (Array.isArray(node)) {
    for (const x of node) {
      collectProductImageKeysDeep(x, out);
    }
    return;
  }
  if (node && typeof node === 'object') {
    for (const v of Object.values(node as Record<string, unknown>)) {
      collectProductImageKeysDeep(v, out);
    }
  }
}

export function jsonToStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === 'string');
}
