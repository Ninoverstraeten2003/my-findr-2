import { qualitySvg, type Quality } from "@/lib/report-quality";

/** A report's accuracy shape (same drawing as on the map). */
export function QualityIcon({ level, color, size = 14 }: { level: Quality; color: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0"
      aria-hidden
      dangerouslySetInnerHTML={{ __html: qualitySvg(level, color, size) }}
    />
  );
}
