import { randomUUID } from 'node:crypto';

// The host execution owns session identity. Model arguments cannot choose it.
export class DshSessions {
  constructor(createClient) { this.createClient = createClient; this.entries = new Map(); this.disposed = false; }
  entry(exec) {
    if (this.disposed) throw new Error('Browser Bridge plugin is disposed');
    const agent = exec?.agent;
    const id = agent?.session?.id;
    if (typeof id !== 'string' || !id) throw new Error('Browser Bridge requires a real DSH agent/session context');
    let entry = this.entries.get(id);
    if (!entry) {
      entry = { agent, client: this.createClient({ client: 'dsh', sessionId: `dsh:${randomUUID()}` }),
        controller: new AbortController(), pending: new Set(), closed: false };
      this.entries.set(id, entry);
    } else if (entry.closed) throw new Error('This browser session is closing');
    else if (entry.agent !== agent) throw new Error('Browser Bridge session belongs to another agent lifecycle');
    return entry;
  }
  async run(exec, operation) {
    const entry = this.entry(exec);
    const signal = exec.signal ? AbortSignal.any([exec.signal, entry.controller.signal]) : entry.controller.signal;
    signal.throwIfAborted();
    const promise = Promise.resolve().then(() => operation(entry.client, { signal }));
    entry.pending.add(promise);
    try { return await promise; } finally { entry.pending.delete(promise); }
  }
  async releaseAgent(agent) {
    const id = agent?.session?.id;
    const entry = this.entries.get(id);
    if (!entry || entry.agent !== agent) return;
    return this.closeEntry(id, entry);
  }
  async closeEntry(id, entry) {
    if (entry.closing) return entry.closing;
    entry.closed = true;
    entry.controller.abort(new Error('Browser Bridge session disposed'));
    entry.closing = (async () => {
      await Promise.allSettled([...entry.pending]);
      try { await entry.client.close(); }
      finally { if (this.entries.get(id) === entry) this.entries.delete(id); }
    })();
    return entry.closing;
  }
  async close() {
    this.disposed = true;
    const outcomes = await Promise.allSettled([...this.entries].map(([id, entry]) => this.closeEntry(id, entry)));
    return outcomes.filter(item => item.status === 'rejected').map(item => item.reason);
  }
}
