// Decrypts batches of Find My reports off the main thread (P-224 ECDH has no WebCrypto support,
// so it runs in plain JavaScript and takes several ms per report).

import { decryptPayload } from "./decrypt-payload";
import type { DecryptedPayload } from "./types";

export interface DecryptRequest {
  id: number;
  privateKey: string;
  payloads: string[];
}

export interface DecryptResponse {
  id: number;
  /** Same order as the request; null when a payload can't be decrypted with this key. */
  results: (DecryptedPayload | null)[];
}

const ctx = self as unknown as {
  onmessage: (e: MessageEvent<DecryptRequest>) => void;
  postMessage: (msg: DecryptResponse) => void;
};

ctx.onmessage = async (e) => {
  const { id, privateKey, payloads } = e.data;
  const results: (DecryptedPayload | null)[] = [];
  for (const payload of payloads) {
    try {
      results.push(await decryptPayload(payload, privateKey));
    } catch {
      results.push(null);
    }
  }
  ctx.postMessage({ id, results });
};
