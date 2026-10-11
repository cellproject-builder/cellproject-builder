import { createJSONStorage, type PersistStorage, type StateStorage } from 'zustand/middleware';

interface Options<S> {
  select?: (state: S) => readonly unknown[];
  scope?: () => unknown;
}

/** Skip unchanged immutable domain fields before Zustand serializes a complete envelope. */
export function createSelectiveJSONStorage<S extends object>(getStorage: () => StateStorage, options: Options<S> = {}): PersistStorage<S> | undefined {
  const storage = createJSONStorage<S>(getStorage);
  if (!storage) return undefined;
  const previous = new Map<string, { version: number | undefined; scope: unknown; selected: readonly unknown[]; result?: unknown }>();
  return {
    getItem: name => { previous.delete(name); return storage.getItem(name); },
    removeItem: name => { previous.delete(name); return storage.removeItem(name); },
    setItem: (name, value) => {
      const selected = options.select?.(value.state) ?? Object.entries(value.state).flat();
      const scope = options.scope?.(), before = previous.get(name);
      if (before && before.scope === scope && before.version === value.version && before.selected.length === selected.length && selected.every((item, index) => Object.is(item, before.selected[index]))) return before.result;
      const entry: { version: number | undefined; scope: unknown; selected: readonly unknown[]; result?: unknown } = { version: value.version, scope, selected };
      previous.set(name, entry);
      const invalidate = () => { if (previous.get(name) === entry) previous.delete(name); };
      try {
        const result = storage.setItem(name, value);
        entry.result = result;
        // Keep the adapter's original return/error contract, while making an
        // identical retry eligible after an asynchronous storage failure.
        if (result && typeof (result as PromiseLike<unknown>).then === 'function') void Promise.resolve(result).catch(invalidate);
        return result;
      } catch (reason) { invalidate(); throw reason; }
    },
  };
}
