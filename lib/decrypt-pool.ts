// A small pool of decrypt workers. Reports are handed out in chunks so all cores work in parallel and
// progress can be shown. Falls back to the main thread if workers aren't available.

import { decryptPayload } from "./decrypt-payload";
import type { DecryptRequest, DecryptResponse } from "./decrypt.worker";
import type { DecryptedPayload } from "./types";

const CHUNK_SIZE = 40;

let workers: Worker[] | null = null;
let workersFailed = false;
let nextId = 1;

function getWorkers(): Worker[] | null {
  if (workers || workersFailed) return workers;
  try {
    const size = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
    workers = Array.from(
      { length: size },
      () => new Worker(new URL("./decrypt.worker.ts", import.meta.url), { type: "module" }),
    );
  } catch {
    workersFailed = true;
    workers = null;
  }
  return workers;
}

function runOnWorker(worker: Worker, privateKey: string, payloads: string[]) {
  return new Promise<(DecryptedPayload | null)[]>((resolve, reject) => {
    const id = nextId++;
    const onMessage = (e: MessageEvent<DecryptResponse>) => {
      if (e.data.id !== id) return;
      cleanup();
      resolve(e.data.results);
    };
    const onError = (e: ErrorEvent) => {
      cleanup();
      reject(e);
    };
    const cleanup = () => {
      worker.removeEventListener("message", onMessage);
      worker.removeEventListener("error", onError);
    };
    worker.addEventListener("message", onMessage);
    worker.addEventListener("error", onError);
    worker.postMessage({ id, privateKey, payloads } satisfies DecryptRequest);
  });
}

async function decryptOnMainThread(privateKey: string, payloads: string[]) {
  const out: (DecryptedPayload | null)[] = [];
  for (let i = 0; i < payloads.length; i++) {
    try {
      out.push(await decryptPayload(payloads[i], privateKey));
    } catch {
      out.push(null);
    }
    if (i % 10 === 9) await new Promise((r) => setTimeout(r, 0)); // keep the page responsive
  }
  return out;
}

/**
 * Decrypts payloads in parallel. Results keep the input order; null = couldn't decrypt.
 * `onProgress(done)` is called as chunks finish.
 */
export async function decryptMany(
  payloads: string[],
  privateKey: string,
  onProgress?: (done: number) => void,
): Promise<(DecryptedPayload | null)[]> {
  const results: (DecryptedPayload | null)[] = new Array(payloads.length).fill(null);
  const chunks: [number, string[]][] = [];
  for (let i = 0; i < payloads.length; i += CHUNK_SIZE) chunks.push([i, payloads.slice(i, i + CHUNK_SIZE)]);

  let done = 0;
  const finish = (start: number, part: (DecryptedPayload | null)[]) => {
    part.forEach((r, k) => (results[start + k] = r));
    done += part.length;
    onProgress?.(done);
  };

  const pool = getWorkers();
  if (!pool) {
    for (const [start, part] of chunks) finish(start, await decryptOnMainThread(privateKey, part));
    return results;
  }

  let next = 0;
  await Promise.all(
    pool.map(async (worker) => {
      while (next < chunks.length) {
        const [start, part] = chunks[next++];
        try {
          finish(start, await runOnWorker(worker, privateKey, part));
        } catch {
          // A worker crashed: finish this chunk here so no report is lost.
          finish(start, await decryptOnMainThread(privateKey, part));
        }
      }
    }),
  );
  return results;
}
