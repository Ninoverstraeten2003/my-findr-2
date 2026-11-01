"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { JEV_ANSWERS_EVENT, labelAnswer, type JevConfig, type JevLabel } from "./jev";
import { blockedReason, executeJev, jevAuthHeaders, prepareJev } from "./jev-runner";
import type { DeviceReport } from "./types";

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

export function useJevLabels(
  reports: DeviceReport[],
  config: JevConfig,
  onSpend: (usd: number) => void,
  deviceId: string | undefined,
) {
  const [cacheVersion, setCacheVersion] = useState(0);
  const [run, setRun] = useState<JevRunState>(IDLE);
  const cancelRef = useRef(false);

  // cacheVersion forces a re-read of the answer cache after a run stores new answers.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const prepared = useMemo(() => prepareJev(reports, config.questions), [reports, config.questions, cacheVersion]);

  const plan: JevPlan = useMemo(
    () => ({ ...prepared.plan, blockedReason: blockedReason(prepared.plan, config) }),
    [prepared, config],
  );

  // Answers stored elsewhere (e.g. by the AI chat's get_labels) show up here too.
  useEffect(() => {
    const bump = () => setCacheVersion((v) => v + 1);
    window.addEventListener(JEV_ANSWERS_EVENT, bump);
    return () => window.removeEventListener(JEV_ANSWERS_EVENT, bump);
  }, []);

  // Switching device cancels a run. Plain refetches don't: answers are stored per report as they arrive.
  useEffect(() => {
    cancelRef.current = true;
    setRun(IDLE);
  }, [deviceId]);

  const start = useCallback(async () => {
    if (plan.blockedReason || plan.reports === 0 || run.running) return;
    cancelRef.current = false;
    setRun({ ...IDLE, running: true, total: plan.pairs });
    const result = await executeJev(prepared.units, {
      authHeaders: jevAuthHeaders(config),
      hardStopUsd: Math.max(plan.usd * OVERSPEND_FACTOR, 0.0005),
      isCancelled: () => cancelRef.current,
      onProgress: (r, cost) => {
        onSpend(cost);
        setCacheVersion((v) => v + 1);
        setRun((s) => ({ ...s, done: r.done, spentUsd: r.spentUsd, tokens: r.tokens, failed: r.failed }));
      },
    });
    setRun({
      running: false,
      done: result.done,
      total: plan.pairs,
      spentUsd: result.spentUsd,
      tokens: result.tokens,
      failed: result.failed,
      error: result.error,
      message: result.stoppedEarly
        ? "Stopped early: real cost ran well above the estimate"
        : cancelRef.current
          ? "Cancelled: answers so far are kept"
          : null,
    });
  }, [plan, prepared, run.running, config, onSpend]);

  const cancel = useCallback(() => {
    cancelRef.current = true;
  }, []);

  const { questions, answers, invalidQuestions } = prepared;

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
