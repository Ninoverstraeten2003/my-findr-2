// get_labels for the AI chat: Jev's labels for a device's reports in a time range, optionally asking Jev for
// the reports that aren't labelled yet (within the user's Jev cost limits).

import { formatLocal } from "./ai-tools";
import { labelAnswer, type JevConfig, type JevLabel, type JevQuestionConfig } from "./jev";
import { blockedReason, executeJev, jevAuthHeaders, prepareJev } from "./jev-runner";
import { reportKey } from "./report-features";
import type { DeviceReport } from "./types";

const MAX_ROWS = 200;

function describe(q: JevQuestionConfig, l: JevLabel): string {
  return q.type === "score" ? `${l.label} (${l.detail.split(" · ")[0]})` : `${l.label} (${Math.round(l.prob * 100)}%)`;
}

export async function getLabelsForTool(
  reports: DeviceReport[],
  config: JevConfig,
  runMissing: boolean,
  onSpend: (usd: number) => void,
) {
  if (!config.enabled) return { error: "Jev labels are turned off in Settings" };
  let prepared = prepareJev(reports, config.questions);
  let run: Record<string, unknown> | undefined;

  if (runMissing && prepared.plan.reports > 0) {
    const blocked = blockedReason(prepared.plan, config);
    if (blocked) {
      run = { skipped: blocked, estimated_usd: Number(prepared.plan.usd.toFixed(5)) };
    } else {
      const r = await executeJev(prepared.units, {
        authHeaders: jevAuthHeaders(config),
        hardStopUsd: Math.max(prepared.plan.usd * 1.5, 0.0005),
        onProgress: (_, cost) => onSpend(cost),
      });
      run = { answers_stored: r.done, reports_asked: prepared.plan.reports, failed: r.failed, cost_usd: Number(r.spentUsd.toFixed(5)), ...(r.error ? { error: r.error } : {}) };
      prepared = prepareJev(reports, config.questions);
    }
  }

  const { questions, answers } = prepared;
  const summary = questions.map((q) => {
    const counts: Record<string, number> = {};
    for (const r of reports) {
      const l = labelAnswer(q, answers.get(reportKey(r))?.[q.id]);
      if (l) counts[l.label] = (counts[l.label] ?? 0) + 1;
    }
    return { question: q.title, type: q.type, counts };
  });

  // Per-report rows; when there are many, keep the least typical ones (lowest scores, least certain) first.
  const rows = reports
    .map((r) => {
      const rec = answers.get(reportKey(r));
      if (!rec) return null;
      const labels: Record<string, string> = {};
      let unusual = 0;
      for (const q of questions) {
        const l = labelAnswer(q, rec[q.id]);
        if (!l) continue;
        labels[q.title] = describe(q, l);
        if (q.type === "score") unusual = Math.max(unusual, 1 - Number(l.optionKey) / Math.max(1, q.options.length - 1));
        else unusual = Math.max(unusual, 1 - l.prob);
      }
      return { time: formatLocal(new Date(r.decrypedPayload.date)), labels, unusual };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);
  const shown =
    rows.length <= MAX_ROWS
      ? rows
      : [...rows].sort((a, b) => b.unusual - a.unusual).slice(0, MAX_ROWS).sort((a, b) => a.time.localeCompare(b.time));

  return {
    note: "Jev labels are hints from a classifier, with its own probabilities or scores (0 = worst); check them against the reports.",
    reports: reports.length,
    labelled: rows.length,
    unlabelled: reports.length - rows.length,
    ...(run ? { run } : {}),
    summary,
    rows: shown.map(({ time, labels }) => ({ time, ...labels })),
    ...(rows.length > MAX_ROWS ? { rows_note: `showing the ${MAX_ROWS} least typical of ${rows.length}` } : {}),
  };
}
