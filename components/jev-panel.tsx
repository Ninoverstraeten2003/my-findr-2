"use client";

import { useMemo, useState } from "react";
import { Sparkles, Loader2, X, Settings as SettingsIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Drawer,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { formatUsd, markSvg, type JevConfig, type JevLabel, type JevMark } from "@/lib/jev";
import { reportKey } from "@/lib/report-features";
import type { useJevLabels } from "@/lib/use-jev-labels";
import type { DeviceReport } from "@/lib/types";

export function MarkIcon({ mark, color, size = 16 }: { mark: JevMark; color: string; size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 text-foreground/60"
      aria-hidden
      dangerouslySetInnerHTML={{ __html: markSvg(mark, color, "currentColor", size) }}
    />
  );
}

interface JevPanelProps {
  reports: DeviceReport[];
  deviceName?: string;
  deviceColor: string;
  config: JevConfig;
  onSelectQuestion: (id: string | null) => void;
  onFocusReport: (key: string) => void;
  onOpenSettings: () => void;
  jev: ReturnType<typeof useJevLabels>;
}

export default function JevPanel({
  reports,
  deviceName,
  deviceColor,
  config,
  onSelectQuestion,
  onFocusReport,
  onOpenSettings,
  jev,
}: JevPanelProps) {
  const [open, setOpen] = useState(false);
  const [listKey, setListKey] = useState<string | null>(null);
  const { questions, plan, run } = jev;
  const active = questions.find((q) => q.id === config.activeQuestionId) ?? null;
  const { labelsFor } = jev;
  const labels = useMemo(() => labelsFor(active?.id ?? null), [labelsFor, active]);

  const reportByKey = useMemo(() => new Map(reports.map((r) => [reportKey(r), r])), [reports]);

  const labelled = useMemo(() => {
    let n = 0;
    for (const r of reports) if (jev.answers.get(reportKey(r))) n++;
    return n;
  }, [reports, jev.answers]);

  // Per-answer statistics for the active question.
  const stats = useMemo(() => {
    if (!active) return [];
    const rows = active.options.map((o) => ({ option: o, count: 0, probSum: 0, items: [] as [string, JevLabel][] }));
    for (const [key, l] of labels) {
      if (!reportByKey.has(key)) continue;
      const row = rows.find((r) => r.option.key === l.optionKey);
      if (!row) continue;
      row.count++;
      row.probSum += l.prob;
      row.items.push([key, l]);
    }
    for (const r of rows) r.items.sort((a, b) => b[1].prob - a[1].prob);
    return rows;
  }, [active, labels, reportByKey]);

  const answeredForActive = stats.reduce((s, r) => s + r.count, 0);
  const listRow = stats.find((r) => r.option.key === listKey) ?? null;

  if (!config.enabled) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="absolute bottom-6 right-4 z-[1000] flex items-center gap-1.5 rounded-full border border-border bg-card/30 px-3 py-2 text-xs font-medium text-card-foreground shadow-md backdrop-blur-md touch-none active:scale-95 transition-transform"
        aria-label="Open Jev labels"
      >
        {run.running ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        <span>{active ? active.title : "Jev"}</span>
        {run.running && (
          <span className="tabular-nums text-muted-foreground">
            {run.done}/{run.total}
          </span>
        )}
      </button>

      <Drawer open={open} onOpenChange={setOpen} shouldScaleBackground={false}>
        <DrawerContent className="max-h-[85dvh] md:max-w-lg md:mx-auto">
          <DrawerHeader className="text-left pb-2">
            <DrawerTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4" /> Jev labels
            </DrawerTitle>
            <DrawerDescription className="text-xs">
              {deviceName ? `${deviceName} · ` : ""}
              {reports.length.toLocaleString()} reports in view · {labelled.toLocaleString()} labelled. Every report stays on
              the map; labels only change a dot&apos;s shape.
            </DrawerDescription>
          </DrawerHeader>

          <div className="flex flex-col gap-4 overflow-y-auto px-4 pb-6">
            {/* Question picker */}
            <div className="sticky top-0 z-10 -mx-4 flex shrink-0 gap-2 overflow-x-auto bg-background px-4 pb-2 pt-1">
              <Chip selected={!active} onClick={() => onSelectQuestion(null)}>
                Off
              </Chip>
              {questions.map((q) => (
                <Chip key={q.id} selected={active?.id === q.id} onClick={() => { onSelectQuestion(q.id); setListKey(null); }}>
                  {q.title}
                </Chip>
              ))}
            </div>
            {jev.invalidQuestions > 0 && (
              <p className="text-xs text-muted-foreground">
                {jev.invalidQuestions} question{jev.invalidQuestions > 1 ? "s are" : " is"} incomplete and skipped. Fix
                {jev.invalidQuestions > 1 ? " them" : " it"} in Settings.
              </p>
            )}

            {/* Legend + stats */}
            {active && (
              <section className="flex flex-col gap-1.5">
                <p className="text-xs text-muted-foreground">{active.instructions}</p>
                {stats.map((row) => {
                  const share = answeredForActive ? row.count / answeredForActive : 0;
                  const isOpen = listKey === row.option.key;
                  return (
                    <button
                      key={row.option.key}
                      onClick={() => setListKey(isOpen ? null : row.option.key)}
                      disabled={row.count === 0}
                      className={cn(
                        "flex flex-col gap-1 rounded-md border px-2.5 py-2 text-left transition-colors",
                        isOpen ? "border-foreground/40 bg-secondary" : "border-border hover:bg-secondary/60",
                        row.count === 0 && "opacity-60",
                      )}
                    >
                      <div className="flex items-center gap-2 text-sm">
                        <MarkIcon mark={row.option.mark} color={deviceColor} />
                        <span className="flex-1 truncate">{row.option.label}</span>
                        <span className="tabular-nums text-muted-foreground text-xs">
                          {row.count.toLocaleString()}
                          {row.count > 0 && ` · avg ${Math.round((row.probSum / row.count) * 100)}%`}
                        </span>
                      </div>
                      <div className="h-1 w-full rounded-full bg-muted">
                        <div className="h-1 rounded-full bg-foreground/40" style={{ width: `${share * 100}%` }} />
                      </div>
                    </button>
                  );
                })}
                {answeredForActive === 0 && (
                  <p className="text-xs text-muted-foreground">No answers yet for this question in the current view.</p>
                )}
              </section>
            )}

            {/* Reports with the selected answer */}
            {listRow && listRow.items.length > 0 && (
              <section className="flex flex-col gap-1">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-medium">
                    {listRow.option.label}: most certain first
                    {listRow.items.length > 50 && ` (top 50 of ${listRow.items.length})`}
                  </h3>
                  <button onClick={() => setListKey(null)} className="p-1 text-muted-foreground" aria-label="Close list">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex flex-col divide-y divide-border rounded-md border border-border">
                  {listRow.items.slice(0, 50).map(([key, l]) => {
                    const r = reportByKey.get(key);
                    if (!r) return null;
                    const p = r.decrypedPayload;
                    return (
                      <button
                        key={key}
                        onClick={() => {
                          setOpen(false);
                          onFocusReport(key);
                        }}
                        className="flex items-center gap-2 px-2.5 py-2 text-left text-xs hover:bg-secondary/60"
                      >
                        <MarkIcon mark={l.mark} color={deviceColor} size={14} />
                        <span className="flex-1">
                          {new Date(p.date).toLocaleString(undefined, {
                            month: "short",
                            day: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                          <span className="block text-muted-foreground">{l.detail}</span>
                        </span>
                        <span className="tabular-nums text-muted-foreground">±{p.location.accuracy} m</span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Run / cost */}
            <section className="flex flex-col gap-2 rounded-md border border-border p-3">
              {run.running ? (
                <>
                  <div className="flex items-center justify-between text-xs">
                    <span>
                      Asking Jev… {run.done.toLocaleString()} / {run.total.toLocaleString()}
                    </span>
                    <span className="tabular-nums text-muted-foreground">{formatUsd(run.spentUsd)} so far</span>
                  </div>
                  <Progress value={run.total ? (run.done / run.total) * 100 : 0} className="h-1.5" />
                  <Button variant="outline" size="sm" onClick={jev.cancel}>
                    Cancel (keeps answers so far)
                  </Button>
                </>
              ) : plan.reports === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {questions.length === 0
                    ? "No questions set up yet."
                    : "Every report in view already has answers for all questions (from the local cache)."}
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                    <span className="text-muted-foreground">New reports to ask</span>
                    <span className="text-right tabular-nums">{plan.reports.toLocaleString()}</span>
                    <span className="text-muted-foreground">Requests</span>
                    <span className="text-right tabular-nums">{plan.requests.toLocaleString()}</span>
                    <span className="text-muted-foreground">Estimated tokens</span>
                    <span className="text-right tabular-nums">≈ {plan.tokens.toLocaleString()}</span>
                    <span className="text-muted-foreground">Estimated cost</span>
                    <span className="text-right tabular-nums font-medium">≈ {formatUsd(plan.usd)}</span>
                    <span className="text-muted-foreground">Limit per run</span>
                    <span className="text-right tabular-nums">
                      ${config.maxCostPerRunUsd} · {config.maxReportsPerRun.toLocaleString()} reports
                    </span>
                  </div>
                  {plan.blockedReason ? (
                    <p className="rounded bg-destructive/10 px-2 py-1.5 text-xs text-destructive">
                      Too big, nothing will be sent. {plan.blockedReason}. Pick a shorter history length or raise the
                      limit in Settings.
                    </p>
                  ) : (
                    <Button size="sm" onClick={jev.start}>
                      <Sparkles className="h-3.5 w-3.5" />
                      Label {plan.reports.toLocaleString()} report{plan.reports === 1 ? "" : "s"} (≈ {formatUsd(plan.usd)})
                    </Button>
                  )}
                </>
              )}

              {!run.running && (run.done > 0 || run.error || run.message) && (
                <p className={cn("text-xs", run.error ? "text-destructive" : "text-muted-foreground")}>
                  {run.error
                    ? `Stopped: ${run.error}.`
                    : `Last run: ${run.done.toLocaleString()} reports, ${run.tokens.toLocaleString()} tokens, ${formatUsd(run.spentUsd)} (OpenRouter's figure).`}
                  {run.failed > 0 && ` ${run.failed} failed and can be retried.`}
                  {run.message && ` ${run.message}.`}
                </p>
              )}
              <p className="text-[11px] text-muted-foreground">
                Paid by{" "}
                {config.userApiKey.trim()
                  ? "your OpenRouter key"
                  : config.accessToken
                    ? "the site owner's shared key"
                    : "no key yet: add your OpenRouter key in Settings"}
                . Spent on this device so far: {formatUsd(config.spentUsd)}. Answers are cached, so each report is
                only asked once per question.
              </p>
            </section>

            <Button
              variant="ghost"
              size="sm"
              className="self-start text-muted-foreground"
              onClick={() => {
                setOpen(false);
                onOpenSettings();
              }}
            >
              <SettingsIcon className="h-3.5 w-3.5" /> Edit questions and limits
            </Button>
          </div>
        </DrawerContent>
      </Drawer>
    </>
  );
}

function Chip({ selected, onClick, children }: { selected: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
        selected ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground",
      )}
    >
      {children}
    </button>
  );
}
