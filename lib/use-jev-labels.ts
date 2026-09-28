"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  JEV_MAX_ITEMS_PER_CALL,
  estimateTokens,
  getCachedAnswer,
  labelAnswer,
  putCachedAnswers,
  questionHash,
  toWireQuestion,
  tokensToUsd,
  validateQuestion,
  type JevConfig,
  type JevLabel,
  type JevQuestionConfig,
  type JevRawAnswer,
} from "./jev";
import { buildReportStates, reportKey } from "./report-features";
import type { DeviceReport } from "./types";

const CLIENT_CONCURRENCY = 2;
/** Stop a run if OpenRouter's reported spend overshoots the estimate this much. */
const OVERSPEND_FACTOR = 1.5;

export interface JevPlan {
  /** Reports that still miss at least one answer. */
  reports: number;
  /** Report x question pairs to ask. */
  pairs: number;
  requests: number;
  tokens: number;
  usd: number;
  /** Why the whole run is skipped, or null when it fits the limits. */
  blockedReason: string | null;
}

export interface JevRunState {
  running: boolean;
  done: number;
  total: number;
  spentUsd: number;
  tokens: number;
  failed: number;
  message: string | null;
  error: string | null;
}

const IDLE: JevRunState = { running: false, done: 0, total: 0, spentUsd: 0, tokens: 0, failed: 0, message: null, error: null };

interface Group {
  questions: JevQuestionConfig[];
  indices: number[];
}

export function useJevLabels(
  reports: DeviceReport[],
  config: JevConfig,
  onSpend: (usd: number) => void,
  deviceId: string | undefined,
) {
  const [cacheVersion, setCacheVersion] = useState(0);
  const [run, setRun] = useState<JevRunState>(IDLE);
  const cancelRef = useRef(false);

  const questions = useMemo(
    () => config.questions.filter((q) => validateQuestion(q) === null),
    [config.questions],
  );
  const invalidQuestions = config.questions.length - questions.length;
  const qHashes = useMemo(() => questions.map(questionHash), [questions]);

  const states = useMemo(() => buildReportStates(reports), [reports]);
  const keys = useMemo(() => reports.map(reportKey), [reports]);

  // Known answers per report key → question id, and which report/question pairs were never asked.
  // Each report is asked once per question: history length and newly arriving reports never re-ask it.
  const { answers, pending } = useMemo(() => {
    const answers = new Map<string, Record<string, JevRawAnswer>>();
    const pending = new Map<number, JevQuestionConfig[]>();
    keys.forEach((key, i) => {
      const rec: Record<string, JevRawAnswer> = {};
      const missing: JevQuestionConfig[] = [];
      questions.forEach((q, qi) => {
        const a = getCachedAnswer(qHashes[qi], key);
        if (a) rec[q.id] = a;
        else missing.push(q);
      });
      if (Object.keys(rec).length) answers.set(key, rec);
      if (missing.length) pending.set(i, missing);
    });
    return { answers, pending };
    // cacheVersion forces a re-read after new answers are stored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions, qHashes, keys, cacheVersion]);

  // Group reports by which questions they need, so one request asks exactly those.
  const groups = useMemo(() => {
    const bySig = new Map<string, Group>();
    reports.forEach((_, i) => {
      const missing = pending.get(i);
      if (!missing) return;
      const sig = missing.map((q) => q.id).join(",");
      const g = bySig.get(sig) ?? { questions: missing, indices: [] };
      g.indices.push(i);
      bySig.set(sig, g);
    });
    return [...bySig.values()];
  }, [reports, pending]);

  const plan: JevPlan = useMemo(() => {
    let tokens = 0;
    let pairs = 0;
    let requests = 0;
    let reportCount = 0;
    for (const g of groups) {
      const qChars = JSON.stringify(Object.fromEntries(g.questions.map((q) => [q.id, toWireQuestion(q)]))).length;
      for (const i of g.indices) tokens += estimateTokens(states[i].length + qChars);
      pairs += g.indices.length * g.questions.length;
      requests += Math.ceil(g.indices.length / JEV_MAX_ITEMS_PER_CALL);
      reportCount += g.indices.length;
    }
    const usd = tokensToUsd(tokens);
    let blockedReason: string | null = null;
    if (reportCount > config.maxReportsPerRun) {
      blockedReason = `${reportCount.toLocaleString()} reports is over your limit of ${config.maxReportsPerRun.toLocaleString()} per run`;
    } else if (usd > config.maxCostPerRunUsd) {
      blockedReason = `The estimate is over your limit of $${config.maxCostPerRunUsd} per run`;
    }
    return { reports: reportCount, pairs, requests, tokens, usd, blockedReason };
  }, [groups, states, config.maxReportsPerRun, config.maxCostPerRunUsd]);

  // Switching device cancels a run. Plain refetches don't: answers are stored per report as they arrive.
  useEffect(() => {
    cancelRef.current = true;
    setRun(IDLE);
  }, [deviceId]);

  const start = useCallback(async () => {
    if (plan.blockedReason || plan.reports === 0 || run.running) return;
    cancelRef.current = false;

    const chunks: { questions: JevQuestionConfig[]; indices: number[] }[] = [];
    for (const g of groups) {
      for (let k = 0; k < g.indices.length; k += JEV_MAX_ITEMS_PER_CALL) {
        chunks.push({ questions: g.questions, indices: g.indices.slice(k, k + JEV_MAX_ITEMS_PER_CALL) });
      }
    }

    let spent = 0;
    let tokens = 0;
    let done = 0;
    let failed = 0;
    let fatal: string | null = null;
    let stopMessage: string | null = null;
    const hardStop = Math.max(plan.usd * OVERSPEND_FACTOR, 0.0005);
    setRun({ ...IDLE, running: true, total: plan.reports });

    let nextChunk = 0;
    const worker = async () => {
      while (nextChunk < chunks.length && !cancelRef.current && !fatal && !stopMessage) {
        const chunk = chunks[nextChunk++];
        const qIndex = chunk.questions.map((q) => questions.indexOf(q));
        const items = chunk.indices.map((i) => ({ key: keys[i], state: states[i] }));
        let res: Response;
        try {
          res = await fetch("/api/jev", {
            method: "POST",
            headers: {
              "content-type": "application/json",
              // Own key: the user pays. Otherwise the owner's shared key, unlocked by the access token.
              ...(config.userApiKey.trim()
                ? { "x-openrouter-key": config.userApiKey.trim() }
                : { "x-jev-token": config.accessToken }),
            },
            body: JSON.stringify({
              questions: Object.fromEntries(chunk.questions.map((q) => [q.id, toWireQuestion(q)])),
              items,
            }),
          });
        } catch {
          fatal = "Couldn't reach the app's /api/jev route";
          break;
        }
        const data = await res.json().catch(() => null);
        if (!res.ok) {
          fatal = data?.error || `Jev route answered ${res.status}`;
          break;
        }

        const toStore: [string, JevRawAnswer][] = [];
        for (const it of items) {
          const r = data.results?.[it.key];
          if (!r?.answers) {
            failed++;
            continue;
          }
          chunk.questions.forEach((q, n) => {
            const a = r.answers[q.id] as JevRawAnswer | undefined;
            if (a && a.type === q.type) toStore.push([`${qHashes[qIndex[n]]}:${it.key}`, a]);
          });
        }
        putCachedAnswers(toStore);

        const cost = Number(data.usage?.cost ?? 0);
        spent += cost;
        tokens += Number(data.usage?.input_tokens ?? 0);
        done += items.length;
        onSpend(cost);
        setCacheVersion((v) => v + 1);
        setRun((r) => ({ ...r, done, spentUsd: spent, tokens, failed }));

        if (spent > hardStop) {
          stopMessage = "Stopped early: real cost ran well above the estimate";
        }
      }
    };

    await Promise.all(Array.from({ length: Math.min(CLIENT_CONCURRENCY, chunks.length) }, worker));

    setRun({
      running: false,
      done,
      total: plan.reports,
      spentUsd: spent,
      tokens,
      failed,
      error: fatal,
      message: stopMessage ?? (cancelRef.current ? "Cancelled: answers so far are kept" : null),
    });
  }, [plan, groups, run.running, questions, qHashes, states, keys, config.accessToken, config.userApiKey, onSpend]);

  const cancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  /** Labels for one question, per report key. */
  const labelsFor = useCallback(
    (questionId: string | null): Map<string, JevLabel> => {
      const out = new Map<string, JevLabel>();
      const q = questions.find((x) => x.id === questionId);
      if (!q) return out;
      for (const [key, rec] of answers) {
        const l = labelAnswer(q, rec[q.id]);
        if (l) out.set(key, l);
      }
      return out;
    },
    [answers, questions],
  );

  return { questions, invalidQuestions, answers, plan, run, start, cancel, labelsFor };
}
