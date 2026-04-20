// Global test environment bootstrap
// jsdom doesn't ship localStorage — provide a minimal in-memory shim
// so template-storage.ts and storage.ts tests work without real browsers.

const localStorageMap: Map<string, string> = new Map()

const localStorageMock = {
  getItem: (key: string) => localStorageMap.get(key) ?? null,
  setItem: (key: string, value: string) => { localStorageMap.set(key, value) },
  removeItem: (key: string) => { localStorageMap.delete(key) },
  clear: () => { localStorageMap.clear() },
  get length() { return localStorageMap.size },
  key: (index: number) => Array.from(localStorageMap.keys())[index] ?? null,
}

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
})

// Silence console output that is expected in tests (e.g. warn from k-means)
// Individual tests can spy/restore if they need to assert on console calls.
jest.spyOn(console, "log").mockImplementation(() => {})
jest.spyOn(console, "warn").mockImplementation(() => {})
jest.spyOn(console, "error").mockImplementation(() => {})
