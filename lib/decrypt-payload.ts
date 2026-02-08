import { ec as EC } from "elliptic";
import type {
  BatteryStatus,
  DecryptedPayload,
  DeviceLocation,
  DeviceReport,
} from "./types";

type KeyPair = EC.KeyPair;
const curve = new EC("p224");

async function sha256(arrayBuffer: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", arrayBuffer));
}

function base64ToByteArray(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function hexStringToByteArray(hexString: string): Uint8Array {
  const length = hexString.length;
  if (length % 2 !== 0) {
    throw new Error("Hex string must have an even length: " + hexString);
  }
  const uint8Array = new Uint8Array(length / 2);
  for (let i = 0; i < length; i += 2) {
    uint8Array[i / 2] =
      (parseHexChar(hexString[i]) << 4) | parseHexChar(hexString[i + 1]);
  }
  return uint8Array;
}

function parseHexChar(char: string): number {
  const code = char.charCodeAt(0);
  return code - (code < 58 ? 48 : code < 97 ? 55 : 87);
}

function byteArrayToBase64(byteArray: Uint8Array): string {
  return btoa(String.fromCharCode(...byteArray));
}

function readUInt32BE(byteArray: Uint8Array, offset: number): number {
  return (
    (byteArray[offset] << 24) |
    (byteArray[offset + 1] << 16) |
    (byteArray[offset + 2] << 8) |
    byteArray[offset + 3]
  );
}

export async function getAdvertisementKey(
  privateKeyBase64: string
): Promise<string> {
  const privateKeyByteArray = base64ToByteArray(privateKeyBase64);
  const privateKeyPair = curve.keyFromPrivate(privateKeyByteArray);
  return await getAdvertisementKeyFromKeyPair(privateKeyPair);
}

async function getAdvertisementKeyFromKeyPair(privateKeyPair: KeyPair) {
  const adv = privateKeyPair.getPublic().getX().toString(16).padStart(56, "0");
  const advBytes = hexStringToByteArray(adv);
  const sha256Hash = await sha256(advBytes);
  return byteArrayToBase64(sha256Hash);
}

export async function decryptPayload(
  payloadBase64: string,
  privateKeyBase64: string
): Promise<DecryptedPayload> {
  const payloadByteArray = base64ToByteArray(payloadBase64);
  const privateKeyByteArray = base64ToByteArray(privateKeyBase64);

  const ephemeralKeyBytes = payloadByteArray.subarray(
    payloadByteArray.length - 16 - 10 - 57,
    payloadByteArray.length - 16 - 10
  );

  const encryptedData = payloadByteArray.subarray(
    payloadByteArray.length - 16 - 10,
    payloadByteArray.length - 16
  );

  const tag = payloadByteArray.subarray(payloadByteArray.length - 16);

  const privateKeyPair = curve.keyFromPrivate(privateKeyByteArray);
  const ephemeralKeyPair = curve.keyFromPublic(ephemeralKeyBytes, "hex");

  const sharedKeyBytes = getECDHKeyDerivation(ephemeralKeyPair, privateKeyPair);
  const derivedKey = await keyDerivation(sharedKeyBytes, ephemeralKeyBytes);

  const decryptedDataByteArray = await decryptEncryptedData(
    encryptedData,
    derivedKey,
    tag
  );

  const report: DecryptedPayload = {
    date: decodeSeenTime(payloadByteArray),
    confidence: decodeConfidence(payloadByteArray),
    battery: decodeBatteryStatus(decryptedDataByteArray),
    location: decodeLocation(decryptedDataByteArray),
  };

  return report;
}

function getECDHKeyDerivation(
  ephemeralPublicKey: KeyPair,
  privateKey: KeyPair
): Uint8Array {
  const sharedKey = privateKey.derive(ephemeralPublicKey.getPublic());
  return hexStringToByteArray(sharedKey.toString(16));
}

function decodeConfidence(payloadByteArray: Uint8Array): number {
  return payloadByteArray[4];
}

function decodeSeenTime(payloadByteArray: Uint8Array): Date {
  const seenTimeStamp = readUInt32BE(payloadByteArray, 0);
  return new Date(Date.UTC(2001, 0, 1) + seenTimeStamp * 1000);
}

function decodeLocation(payloadArrayBuffer: Uint8Array): DeviceLocation {
  const latitude = readUInt32BE(payloadArrayBuffer, 0) / 10000000.0;
  const longitude = readUInt32BE(payloadArrayBuffer, 4) / 10000000.0;
  const accuracy = payloadArrayBuffer[8];

  return {
    latitude,
    longitude,
    accuracy,
  };
}

async function decryptEncryptedData(
  encryptedData: Uint8Array,
  symmetricKey: Uint8Array,
  tag: Uint8Array
): Promise<Uint8Array> {
  const decryptionKey = symmetricKey.subarray(0, 16);
  const iv = symmetricKey.subarray(16);

  const importedKey = await crypto.subtle.importKey(
    "raw",
    decryptionKey,
    { name: "AES-GCM", length: 128 },
    false,
    ["decrypt"]
  );

  const combinedData = new Uint8Array(encryptedData.length + tag.length);
  combinedData.set(encryptedData);
  combinedData.set(tag, encryptedData.length);

  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv, tagLength: 128 },
    importedKey,
    combinedData
  );
  return new Uint8Array(decrypted);
}

async function keyDerivation(
  secretByteArray: Uint8Array,
  ephemeralKeyByteArray: Uint8Array
): Promise<Uint8Array> {
  const combinedArray = new Uint8Array(
    secretByteArray.length + 4 + ephemeralKeyByteArray.length
  );
  combinedArray.set(secretByteArray);
  combinedArray.set(new Uint8Array([0, 0, 0, 1]), secretByteArray.length);
  combinedArray.set(ephemeralKeyByteArray, secretByteArray.length + 4);

  return new Uint8Array(await crypto.subtle.digest("SHA-256", combinedArray));
}

function decodeBatteryStatus(decryptedData: Uint8Array): BatteryStatus {
  const statusByte = decryptedData[9];
  const batteryLevel = (statusByte >> 6) & 0b11;
  const batteryMap: BatteryStatus[] = ["Full", "Medium", "Low", "Critical"];
  return batteryMap[batteryLevel];
}

export function calculateBestLocation(deviceReports: DeviceReport[]) {
  const valid = deviceReports
    .filter((r) => {
      const loc = r?.decrypedPayload?.location;
      const date = r?.decrypedPayload?.date;
      return (
        loc?.latitude != null &&
        loc?.longitude != null &&
        loc?.accuracy != null &&
        date &&
        Math.abs(loc.latitude) <= 90 &&
        Math.abs(loc.longitude) <= 180
      );
    })
    .sort(
      (a, b) =>
        b.decrypedPayload.date.getTime() - a.decrypedPayload.date.getTime()
    );

  if (valid.length === 0) return null;

  const newest = valid[0];
  const clusterCenter = newest.decrypedPayload.location;
  const CLUSTER_RADIUS_M = 500;

  const cluster = valid.filter((r) => {
    const dist = haversineMeters(
      clusterCenter.latitude,
      clusterCenter.longitude,
      r.decrypedPayload.location.latitude,
      r.decrypedPayload.location.longitude
    );
    return dist <= CLUSTER_RADIUS_M;
  });

  let totalLat = 0,
    totalLon = 0,
    totalWeight = 0;
  const now = Date.now();

  for (const r of cluster) {
    const loc = r.decrypedPayload.location;
    const ageHours = (now - r.decrypedPayload.date.getTime()) / 3_600_000;
    const accuracy = Math.max(1, loc.accuracy);

    const weight = (1 / accuracy) * Math.pow(0.5, ageHours);
    totalLat += loc.latitude * weight;
    totalLon += loc.longitude * weight;
    totalWeight += weight;
  }

  return {
    lat: totalLat / totalWeight,
    lon: totalLon / totalWeight,
    reportsInCluster: cluster.length,
    totalValidReports: valid.length,
  };
}

function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6_371_000;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
