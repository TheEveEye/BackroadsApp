// Simple generic LRU cache based on Map preserving insertion order.
// Operations are O(1) average for get/set/has. Evicts least-recently-used on overflow.
export class LRUCache<V> {
  private map: Map<string, V>;
  private capacity: number;

  constructor(capacity = 100) {
    this.map = new Map();
    this.capacity = Math.max(1, capacity);
  }

  get(key: string): V | undefined {
    const val = this.map.get(key);
    if (val !== undefined) {
      // refresh recency
      this.map.delete(key);
      this.map.set(key, val);
    }
    return val;
  }

  set(key: string, value: V): void {
    if (this.map.has(key)) {
      this.map.delete(key);
    } else if (this.map.size >= this.capacity) {
      // Evict least-recently-used (first entry in insertion order)
      const firstKey = this.map.keys().next().value as string | undefined;
      if (firstKey !== undefined) this.map.delete(firstKey);
    }
    this.map.set(key, value);
  }

  has(key: string): boolean {
    return this.map.has(key);
  }

  clear(): void {
    this.map.clear();
  }
}

// Utility: fast, stable 32-bit FNV-1a hash for strings; returns unsigned integer as hex string
export function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5; // offset basis
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime 0x01000193
    hash = (hash >>> 0) * 0x01000193;
  }
  // Ensure unsigned 32-bit and to hex
  return (hash >>> 0).toString(16);
}
