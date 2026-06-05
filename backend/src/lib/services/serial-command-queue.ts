// One serialized TX/RX command queue (mutex) per physical serial COM port.
//
// A controller cannot have two commands in flight at once or their TX/RX bytes
// interleave and ACK matching corrupts. This queue guarantees at most one
// non-priority command runs at a time PER PORT. Because queues are keyed by the
// port string, two services targeting the SAME COM port automatically share the
// SAME queue — which is exactly what shared-port routing requires.

export class SerialCommandQueue {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(public readonly port: string) {}

  /**
   * Run `task` after all previously-queued tasks for this port complete.
   * `priority` (e.g. Stop) bypasses the chain so it still runs even if a prior
   * command is stuck waiting on an ACK. A task that rejects (timeout/error)
   * never wedges the queue — the chain swallows it so the next command runs.
   */
  enqueue<T>(task: () => Promise<T>, opts: { priority?: boolean } = {}): Promise<T> {
    if (opts.priority) {
      return task();
    }
    const run = () => task();
    const result = this.chain.then(run, run);
    this.chain = result.catch(() => undefined);
    return result;
  }
}

const registry = new Map<string, SerialCommandQueue>();

/** Return the single shared queue for `port`, creating it on first use. */
export function getSerialQueue(port: string): SerialCommandQueue {
  let queue = registry.get(port);
  if (!queue) {
    queue = new SerialCommandQueue(port);
    registry.set(port, queue);
  }
  return queue;
}
