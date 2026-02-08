export async function encryptSettings(settings: any): Promise<string> {
  const json = JSON.stringify(settings);
  const enc = new TextEncoder();
  const data = enc.encode(json);

  const key = await window.crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: 256,
    },
    true,
    ["encrypt", "decrypt"]
  );

  const iv = window.crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await window.crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    key,
    data
  );

  const exportedKey = await window.crypto.subtle.exportKey("raw", key);

  // Convert to base64 for URL
  const b64Data = btoa(String.fromCharCode(...new Uint8Array(encrypted)));
  const b64Iv = btoa(String.fromCharCode(...iv));
  const b64Key = btoa(String.fromCharCode(...new Uint8Array(exportedKey)));

  // Combine IV and Data, then URL encode the whole thing
  // We use a dot separator: IV.DATA
  const payload = b64Iv + "." + b64Data;
  const safePayload = encodeURIComponent(payload);
  const safeKey = encodeURIComponent(b64Key);

  return `?data=${safePayload}#key=${safeKey}`;
}

export async function decryptSettings(
  dataParam: string,
  keyParam: string
): Promise<any> {
  // dataParam is already decoded by URLSearchParams usually, but let's be safe.
  // Actually, if we use URLSearchParams to get 'data', it is already decoded.
  // So 'dataParam' should be "IV.DATA" (Base64 chars).
  
  const parts = dataParam.split(".");
  if (parts.length !== 2) throw new Error("Invalid data format");
  const [b64Iv, b64Data] = parts;

  // keyParam should be the raw key string (no #key= prefix)
  // If it comes from URLSearchParams of the hash, it is also decoded.
  const b64Key = keyParam;

  if (!b64Key) throw new Error("Missing key");

  const iv = Uint8Array.from(atob(b64Iv), (c) => c.charCodeAt(0));
  const data = Uint8Array.from(atob(b64Data), (c) => c.charCodeAt(0));
  const rawKey = Uint8Array.from(atob(b64Key), (c) => c.charCodeAt(0));

  const key = await window.crypto.subtle.importKey(
    "raw",
    rawKey,
    "AES-GCM",
    true,
    ["encrypt", "decrypt"]
  );

  const decrypted = await window.crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: iv,
    },
    key,
    data
  );

  const dec = new TextDecoder();
  return JSON.parse(dec.decode(decrypted));
}
