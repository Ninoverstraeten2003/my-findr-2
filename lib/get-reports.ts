import { decryptPayload, getAdvertisementKey } from "./decrypt-payload";
import type { Device, DeviceReport } from "./types";

export async function getReportsForDevice(
  device: Device,
  apiURL: string,
  username: string,
  password: string,
  days = 7,
  usePoller: boolean = false,
  pollerApiKey: string = ""
): Promise<DeviceReport[]> {
  device.advertismentKey = await getAdvertisementKey(device.privateKey);

  let reports: DeviceReport[] = [];

  if (usePoller && pollerApiKey) {
    reports = await fetchPollerReports(device.advertismentKey, pollerApiKey);
  } else {
    reports = await fetchDevicesReports(
      [device.advertismentKey],
      days,
      apiURL,
      username,
      password
    );
  }

  const decryptedReports: DeviceReport[] = [];

  const decryptReport = async (report: DeviceReport) => {
    try {
      const decryptedPayload = await decryptPayload(
        report.payload,
        device.privateKey
      );
      report.decrypedPayload = decryptedPayload;
      decryptedReports.push(report);
    } catch (error) {
      console.error("Failed to decrypt payload:", error);
    }
  };

  for (let i = 0; i < reports.length; i++) {
    await decryptReport(reports[i]);
    if (i % 10 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }

  const sortedReports = decryptedReports.sort(
    (a, b) =>
      new Date(a.decrypedPayload.date).getTime() -
      new Date(b.decrypedPayload.date).getTime()
  );
  return sortedReports;
}

async function fetchDevicesReports(
  base64AdvertisementKey: string[] = [],
  days: number = 7,
  apiURL: string,
  username: string,
  password: string
): Promise<DeviceReport[]> {
  const isDemo = apiURL.includes("sample.json");
  const isBasicAuth = username !== "" && password !== "";

  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };
  if (isBasicAuth) {
    headers.Authorization = "Basic " + btoa(`${username}:${password}`);
  }

  const options: RequestInit = {
    method: isDemo ? "GET" : "POST",
    headers,
    body: isDemo ? null : JSON.stringify({ ids: base64AdvertisementKey, days }),
  };

  const response = await fetch(apiURL, options);

  if (!response.ok) {
    const error: any = new Error("Network response was not ok");
    error.status = response.status;
    throw error;
  }

  return response.json().then((response) => {
    if (!response.statusCode || response.statusCode !== "200") {
      throw new Error("API response was not ok");
    }
    return response.results as DeviceReport[];
  });
}

async function fetchPollerReports(
  advertisementKey: string,
  apiKey: string
): Promise<DeviceReport[]> {
  // URL Encode the key just in case, though it usually is safebase64 or similar
  const encodedKey = encodeURIComponent(advertisementKey);
  const url = `https://findr.ninoverstraeten.com/api/reports/${encodedKey}`;

  let response;
  try {
    response = await fetch(url, {
      headers: {
        "X-API-Key": apiKey,
      },
    });
  } catch (err) {
    // TypeError usually means network error or CORS block
    if (err instanceof TypeError) {
      const error: any = new Error("Network or CORS error connecting to Poller");
      error.status = 0;
      throw error;
    }
    throw err;
  }

  if (!response.ok) {
    const error: any = new Error("Poller network response was not ok");
    error.status = response.status;
    throw error;
  }

  const data = await response.json();
  
  // Map Poller response to DeviceReport[]
  // Poller response format:
  // [
  //   {
  //     "id": 1,
  //     "hashed_public_key": "...",
  //     "timestamp": 1700000000,
  //     "encrypted_report": "SGVsbG8=",
  //     "received_at": "..."
  //   }, ...
  // ]
  
  return data.map((item: any) => ({
    id: String(item.id),
    payload: item.encrypted_report,
    // decrypedPayload will be added by the main function
  })) as DeviceReport[];
}
