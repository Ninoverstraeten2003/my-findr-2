// Plans and runs Jev labelling for a set of reports. Used by the Labels panel and the AI chat's get_labels tool.
//  - Each report is asked once per question (answers are cached per report + question).
//  - Per-report questions send one report with its neighbours per item; batch questions send a table of up to
//    10 reports per item with one wire question per report.
//  - /api/jev takes up to 20 items that share the same questions per call.

import {
  JEV_BATCH_SIZE,
  JEV_MAX_ITEMS_PER_CALL,
  estimateTokens,
  getCachedAnswer,
  putCachedAnswers,
  questionHash,
  toWireQuestion,
  tokensToUsd,
  validateQuestion,
  type JevConfig,
  type JevQuestionConfig,
  type JevRawAnswer,
  type JevWireQuestion,
} from "./jev";
import { buildBatchTable, buildReportStates, reportKey } from "./report-features";
import type { DeviceReport } from "./types";

/** A batch's targets may sit at most this many rows apart (keeps the table short). */
const MAX_BATCH_SPAN_ROWS = 30;
const CLIENT_CONCURRENCY = 2;

interface Unit {
  /** Shared by all units that can go in the same call. */
  signature: string;
  questions: Record<string, JevWireQuestion>;
  item: { key: string; state: string };
  /** wire question key -> where its answer is stored */
  targets: { wireKey: string; cacheKey: string; type: JevQuestionConfig["type"] }[];
  reports: number;
}

export interface JevPrepared {
  questions: JevQuestionConfig[];
  invalidQuestions: number;
  /** Known answers per report key -> question id. */
  answers: Map<string, Record<string, JevRawAnswer>>;
  units: Unit[];
  plan: { reports: number; pairs: number; requests: number; tokens: number; usd: number };
}

export function prepareJev(reports: DeviceReport[], allQuestions: JevQuestionConfig[]): JevPrepared {
  const questions = allQuestions.filter((q) => validateQuestion(q) === null);
  const qHashes = questions.map(questionHash);
  const keys = reports.map(reportKey);

  const answers = new Map<string, Record<string, JevRawAnswer>>();
  const missingSingle = new Map<number, number[]>(); // report index -> question indexes (per-report mode)
  const missingBatch = new Map<number, number[]>(); // question index -> report indexes (batch mode)
  keys.forEach((key, i) => {
    const rec: Record<string, JevRawAnswer> = {};
    questions.forEach((q, qi) => {
      const a = getCachedAnswer(qHashes[qi], key);
      if (a) {
        rec[q.id] = a;
        return;
      }
      if (q.batch) missingBatch.set(qi, [...(missingBatch.get(qi) ?? []), i]);
      else missingSingle.set(i, [...(missingSingle.get(i) ?? []), qi]);
    });
    if (Object.keys(rec).length) answers.set(key, rec);
  });

  const units: Unit[] = [];
  const pendingReports = new Set<number>();

  // Per-report questions: one item per report, its missing questions on the wire.
  if (missingSingle.size) {
    const states = buildReportStates(reports);
    for (const [i, qis] of missingSingle) {
      pendingReports.add(i);
      units.push({
        signature: `single:${qis.join(",")}`,
        questions: Object.fromEntries(qis.map((qi) => [questions[qi].id, toWireQuestion(questions[qi])])),
        item: { key: keys[i], state: states[i] },
        targets: qis.map((qi) => ({ wireKey: questions[qi].id, cacheKey: `${qHashes[qi]}:${keys[i]}`, type: questions[qi].type })),
        reports: 1,
      });
    }
  }

  // Batch questions: chunks of up to 10 unanswered reports, close together in time order.
  for (const [qi, idx] of missingBatch) {
    const q = questions[qi];
    const chunks: number[][] = [];
    for (const i of idx) {
      const cur = chunks[chunks.length - 1];
      if (cur && cur.length < JEV_BATCH_SIZE && i - cur[0] <= MAX_BATCH_SPAN_ROWS) cur.push(i);
      else chunks.push([i]);
    }
    for (const chunk of chunks) {
      chunk.forEach((i) => pendingReports.add(i));
      const wire = toWireQuestion(q);
      units.push({
        signature: `batch:${qi}:${chunk.length}`,
        questions: Object.fromEntries(
          chunk.map((_, n) => [`r${n + 1}`, { ...wire, instructions: `Report #${n + 1}: ${wire.instructions}` }]),
        ),
        item: { key: `b${keys[chunk[0]]}`, state: buildBatchTable(reports, chunk) },
        targets: chunk.map((i, n) => ({ wireKey: `r${n + 1}`, cacheKey: `${qHashes[qi]}:${keys[i]}`, type: q.type })),
        reports: chunk.length,
      });
    }
  }

  let tokens = 0;
  let pairs = 0;
  for (const u of units) {
    tokens += estimateTokens(u.item.state.length + JSON.stringify(u.questions).length);
    pairs += u.targets.length;
  }
  const calls = groupCalls(units).length;
  return {
    questions,
    invalidQuestions: allQuestions.length - questions.length,
    answers,
    units,
    plan: { reports: pendingReports.size, pairs, requests: calls, tokens, usd: tokensToUsd(tokens) },
  };
}

/** Why a planned run must be skipped entirely, or null when it fits the user's limits. */
export function blockedReason(plan: JevPrepared["plan"], config: JevConfig): string | null {
  if (plan.reports > config.maxReportsPerRun) {
    return `${plan.reports.toLocaleString()} reports is over your limit of ${config.maxReportsPerRun.toLocaleString()} per run`;
  }
  if (plan.usd > config.maxCostPerRunUsd) return `The estimate is over your limit of $${config.maxCostPerRunUsd} per run`;
  return null;
}

function groupCalls(units: Unit[]): Unit[][] {
  const bySig = new Map<string, Unit[]>();
  for (const u of units) bySig.set(u.signature, [...(bySig.get(u.signature) ?? []), u]);
  const calls: Unit[][] = [];
  for (const group of bySig.values()) {
    for (let k = 0; k < group.length; k += JEV_MAX_ITEMS_PER_CALL) calls.push(group.slice(k, k + JEV_MAX_ITEMS_PER_CALL));
  }
  return calls;
}

export interface JevRunResult {
  /** Answers stored (report x question). */
  done: number;
  failed: number;
  spentUsd: number;
  tokens: number;
  error: string | null;
  stoppedEarly: boolean;
}

/**
 * Sends the planned units and caches every answer as it arrives. Stops on a route error, when `isCancelled()`
 * turns true, or when real spend exceeds `hardStopUsd`.
 */
export async function executeJev(
  units: Unit[],
  opts: {
    authHeaders: Record<string, string>;
    hardStopUsd: number;
    isCancelled?: () => boolean;
    onProgress?: (r: JevRunResult, costDelta: number) => void;
  },
): Promise<JevRunResult> {
  const calls = groupCalls(units);
  const result: JevRunResult = { done: 0, failed: 0, spentUsd: 0, tokens: 0, error: null, stoppedEarly: false };
  let next = 0;
  const worker = async () => {
    while (next < calls.length && !opts.isCancelled?.() && !result.error && !result.stoppedEarly) {
      const call = calls[next++];
      let res: Response;
      try {
        res = await fetch("/api/jev", {
          method: "POST",
          headers: { "content-type": "application/json", ...opts.authHeaders },
          body: JSON.stringify({ questions: call[0].questions, items: call.map((u) => u.item) }),
        });
      } catch {
        result.error = "Couldn't reach the app's /api/jev route";
        break;
      }
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        result.error = data?.error || `Jev route answered ${res.status}`;
        break;
      }
      const toStore: [string, JevRawAnswer][] = [];
      for (const u of call) {
        const r = data.results?.[u.item.key];
        if (!r?.answers) {
          result.failed += u.targets.length;
          continue;
        }
        for (const t of u.targets) {
          const a = r.answers[t.wireKey] as JevRawAnswer | undefined;
          if (a && a.type === t.type) {
            toStore.push([t.cacheKey, a]);
            result.done++;
          } else result.failed++;
        }
      }
      putCachedAnswers(toStore);
      const cost = Number(data.usage?.cost ?? 0);
      result.spentUsd += cost;
      result.tokens += Number(data.usage?.input_tokens ?? 0);
      if (result.spentUsd > opts.hardStopUsd) result.stoppedEarly = true;
      opts.onProgress?.({ ...result }, cost);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CLIENT_CONCURRENCY, calls.length) }, worker));
  return result;
}

/** The OpenRouter credentials headers from the shared settings (own key wins over the owner token). */
export function jevAuthHeaders(config: JevConfig): Record<string, string> {
  return config.userApiKey.trim() ? { "x-openrouter-key": config.userApiKey.trim() } : { "x-jev-token": config.accessToken };
}
