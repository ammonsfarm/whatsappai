export class RecentSet {
  private readonly values = new Map<string, number>();

  constructor(private readonly ttlMs: number) {}

  has(value: string) {
    this.prune();
    return this.values.has(value);
  }

  add(value: string) {
    this.prune();
    this.values.set(value, Date.now() + this.ttlMs);
  }

  claim(value: string) {
    if (this.has(value)) return false;
    this.add(value);
    return true;
  }

  private prune() {
    const now = Date.now();
    for (const [key, expires] of this.values) {
      if (expires <= now) this.values.delete(key);
    }
  }
}

