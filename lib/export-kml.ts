import type { DeviceReport } from "./types";

export function exportKML(reports: DeviceReport[]) {
  const placemarks = reports
    .map((r) => {
      const { location, date } = r.decrypedPayload;
      return `
    <Placemark>
      <name>${date.toISOString()}</name>
      <Point>
        <coordinates>${location.longitude},${location.latitude},0</coordinates>
      </Point>
    </Placemark>`;
    })
    .join("\n");

  const kml = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Device Trail</name>
    ${placemarks}
  </Document>
</kml>`;

  const blob = new Blob([kml], { type: "application/vnd.google-earth.kml+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "device-trail.kml";
  a.click();
  URL.revokeObjectURL(url);
}
