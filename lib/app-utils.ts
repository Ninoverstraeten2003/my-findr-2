export function pluralize(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

export function timeSince(date: Date | string | number): string {
  const seconds = Math.floor((Date.now() - new Date(date).getTime()) / 1000);

  const intervals: [number, string][] = [
    [31536000, "year"],
    [2592000, "month"],
    [86400, "day"],
    [3600, "hour"],
    [60, "minute"],
    [1, "second"],
  ];

  for (const [secs, label] of intervals) {
    const interval = Math.floor(seconds / secs);
    if (interval >= 1) {
      return pluralize(interval, label);
    }
  }
  return "just now";
}

export const materialIcons = [
  "MapPin",
  "Circle",
  "Star",
  "Flower2",
  "Car",
  "Bus",
  "User",
  "Camera",
  "Smartphone",
  "Laptop",
  "Key",
  "TreePine",
  "Baby",
  "Bike",
] as const;

export type IconName = (typeof materialIcons)[number];
