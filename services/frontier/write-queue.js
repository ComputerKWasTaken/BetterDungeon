// services/frontier/write-queue.js
//
// Frontier write-path coordinator. Wraps upsertStoryCard with per-card
// serialization, last-write-wins coalescing, exponential-backoff retry,
// and optimistic local echo.
//
// This is a Phase 1 transport-hardening primitive. Every Frontier component
// that writes cards (Core heartbeat, ops-dispatcher responses, modules via
// ctx.writeCard) goes through this queue. Direct upsertStoryCard calls are
// not allowed once the queue is active.
//
// Design constraints:
//   * No two outbound mutations for the same card title are in flight at
//     the same time. This prevents server-side last-write-wins races.
//   * Rapid successive writes to the same card coalesce — only the latest
//     value is sent when the current in-flight request completes.
//   * Transient failures (network errors, HTTP 5xx) retry with capped
//     exponential backoff. Permanent failures (4xx, structured GraphQL
//     errors) reject immediately.
//   * Optimistic echo: the write is merged into ws-stream's card map
//     immediately so downstream consumers see the update without waiting
//     for the server round-trip. Reconciliation happens on server echo;
//     rollback on hard failure.
//
// See:
//   - Project Management/frontier/01-architecture.md (write-queue)
//   - Project Management/frontier/04-implementation-plan.md (Phase 1, item 4)

(function () {
  if (window.Frontier?.writeQueue) return;

  const TAG = '[Frontier/write-queue]';

  // ---------- configuration ----------

  const MAX_RETRIES = 3;
  const BACKOFF_BASE_MS = 500;      // 500ms → 1s → 2s → 4s
  const BACKOFF_CAP_MS = 4000;

  // ---------- state ----------

  // Per-card-title queue entry shape:
  //   {
  //     inflight: Promise | null,   — currently in-flight mutation
  //     pending:  { value, opts, resolve, reject } | null,  — coalesced next write
  //   }
  const queues = new Map();  // title -> queue entry

  const metrics = {
    writes: 0,       // total enqueue() calls
    dispatched: 0,   // mutations actually sent to the server
    coalesced: 0,    // writes absorbed into a pending slot
    retries: 0,      // retry attempts
    failures: 0,     // permanently failed writes
  };

  // The underlying write function, injected by core.js (wraps AIDungeonService.upsertStoryCard).
  let writeFn = null;

  // ---------- helpers ----------

  function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // Classify an error as transient (retryable) or permanent.
  function isTransient(err) {
    if (!err) return false;
    const msg = (err.message || '').toLowerCase();
    // Network failures.
    if (msg.includes('failed to fetch') || msg.includes('network') || msg.includes('timeout')) return true;
    // HTTP 5xx (our replay path includes the status in the error message).
    if (/\b5\d{2}\b/.test(msg)) return true;
    // GraphQL transient errors.
    if (msg.includes('throttl') || msg.includes('rate limit')) return true;
    return false;
  }

  // ws-stream accessors for optimistic echo. Lazy-resolved because
  // write-queue.js loads before ws-stream fully initializes.
  function wsStream() {
    return window.Frontier?.ws || null;
  }

  // ---------- optimistic echo ----------

  // Merge the write into ws-stream's card map immediately so downstream
  // consumers see the update before the server round-trips. Returns the
  // previous card snapshot (for rollback on failure).
  function optimisticSet(title, value, opts) {
    const ws = wsStream();
    if (!ws?._optimisticCardSet) return null;

    // Find existing card by title to get its id.
    let existing = null;
    const cards = ws.getCards?.();
    if (cards) {
      for (const card of cards.values()) {
        if (card?.title === title) { existing = card; break; }
      }
    }

    if (existing) {
      const updated = { ...existing, value, ...(opts.type ? { type: opts.type } : {}) };
      ws._optimisticCardSet(existing.id, updated);
      return existing; // return prev for rollback
    }
    // Card doesn't exist yet (create). We don't know the id the server will
    // assign, so we can't optimistically insert. The server echo will add it.
    return null;
  }

  function optimisticRollback(title, prev) {
    const ws = wsStream();
    if (!ws?._optimisticCardRollback || !prev) return;
    ws._optimisticCardRollback(prev.id, prev);
  }

  // ---------- core dispatch logic ----------

  async function dispatchWrite(title, value, opts) {
    if (!writeFn) {
      throw new Error(`${TAG} writeFn not set. Call Frontier.writeQueue.setWriteFn() first.`);
    }

    let lastErr = null;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        metrics.retries++;
        const backoff = Math.min(BACKOFF_BASE_MS * Math.pow(2, attempt - 1), BACKOFF_CAP_MS);
        await delay(backoff);
      }

      try {
        metrics.dispatched++;
        const result = await writeFn(title, value, opts);
        return result;
      } catch (err) {
        lastErr = err;
        if (!isTransient(err)) {
          // Permanent failure — don't retry.
          break;
        }
        // Transient — retry (loop continues).
        console.warn(TAG, `transient failure writing '${title}' (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`, err.message);
      }
    }

    // All retries exhausted or permanent failure.
    metrics.failures++;
    throw lastErr;
  }

  // Process the queue for a given card title. Ensures only one write is
  // in flight at a time; coalesced writes fire when the current one finishes.
  async function processQueue(title) {
    const q = queues.get(title);
    if (!q || q.inflight || !q.pending) return;

    // Take the pending write.
    const { value, opts, resolve, reject } = q.pending;
    q.pending = null;

    // Optimistic echo.
    const prev = optimisticSet(title, value, opts);

    // Mark in-flight.
    q.inflight = dispatchWrite(title, value, opts)
      .then((result) => {
        resolve(result);
        return result;
      })
      .catch((err) => {
        // Roll back optimistic echo on hard failure.
        optimisticRollback(title, prev);
        reject(err);
        throw err;
      })
      .finally(() => {
        q.inflight = null;
        // If another write was coalesced while we were in flight, process it.
        if (q.pending) {
          processQueue(title);
        } else {
          // No more work — clean up the queue entry.
          queues.delete(title);
        }
      });
  }

  // ---------- public API ----------

  function enqueue(title, value, opts = {}) {
    metrics.writes++;

    return new Promise((resolve, reject) => {
      let q = queues.get(title);
      if (!q) {
        q = { inflight: null, pending: null };
        queues.set(title, q);
      }

      if (q.pending) {
        // A write is already queued (and one is in flight). Replace it —
        // last-write-wins. Reject the previous pending promise so the caller
        // knows their write was superseded.
        q.pending.reject(new Error(`${TAG} write to '${title}' superseded by a newer write`));
        metrics.coalesced++;
      }

      q.pending = { value, opts, resolve, reject };

      // If nothing is in flight, start processing immediately.
      if (!q.inflight) {
        processQueue(title);
      }
      // Otherwise, processQueue will pick up q.pending when inflight finishes.
    });
  }

  function setWriteFn(fn) {
    if (typeof fn !== 'function') {
      throw new TypeError(`${TAG} setWriteFn: expected a function`);
    }
    writeFn = fn;
  }

  function getPending() {
    const out = new Map();
    for (const [title, q] of queues) {
      if (q.pending) {
        out.set(title, { value: q.pending.value, opts: q.pending.opts });
      }
    }
    return out;
  }

  function getMetrics() {
    return { ...metrics };
  }

  // ---------- expose ----------

  const writeQueue = {
    enqueue,
    setWriteFn,
    getPending,
    getMetrics,
    // Debug inspection.
    inspect: () => ({
      queuedTitles: [...queues.keys()],
      inflight: [...queues.entries()].filter(([, q]) => q.inflight).map(([t]) => t),
      pending: [...queues.entries()].filter(([, q]) => q.pending).map(([t]) => t),
      metrics: getMetrics(),
    }),
  };

  window.Frontier = window.Frontier || {};
  window.Frontier.writeQueue = writeQueue;
})();
