"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { MarkIcon } from "@/components/jev-panel";
import {
  DEFAULT_JEV_QUESTIONS,
  JEV_MARKS,
  JEV_MAX_QUESTIONS,
  JEV_MODEL,
  JEV_PRICE_PER_M_INPUT_TOKENS,
  clearJevCache,
  formatUsd,
  jevCacheSize,
  slugKey,
  validateQuestion,
  type JevAnswerOption,
  type JevMark,
  type JevQuestionConfig,
  type JevQuestionType,
} from "@/lib/jev";
import { useJevConfig } from "@/lib/use-jev-config";

const TYPE_LABELS: Record<JevQuestionType, string> = {
  noul: "Yes / no",
  choice: "Pick one answer",
  score: "Score on a scale",
};

function templateOptions(type: JevQuestionType): JevAnswerOption[] {
  if (type === "noul") {
    return [
      { key: "true", label: "Yes", description: "Describe when the answer is yes.", mark: "cross" },
      { key: "false", label: "No", description: "Describe when the answer is no.", mark: "dot" },
      { key: "unsure", label: "Unsure", description: "", mark: "dashed" },
    ];
  }
  if (type === "score") {
    return [
      { key: "0", label: "Low", description: "Describe the lowest level.", mark: "ring" },
      { key: "1", label: "Medium", description: "Describe the middle level.", mark: "dot" },
      { key: "2", label: "High", description: "Describe the highest level.", mark: "double" },
    ];
  }
  return [
    { key: "option_a", label: "Option A", description: "Describe when this applies.", mark: "dot" },
    { key: "option_b", label: "Option B", description: "Describe when this applies.", mark: "square" },
  ];
}

export default function JevSettingsCard() {
  const [config, updateConfig] = useJevConfig();
  const [cacheSize, setCacheSize] = useState(0);

  useEffect(() => setCacheSize(jevCacheSize()), [config]);

  const setQuestion = (id: string, patch: (q: JevQuestionConfig) => JevQuestionConfig) =>
    updateConfig((c) => ({ ...c, questions: c.questions.map((q) => (q.id === id ? patch(q) : q)) }));

  const addQuestion = () =>
    updateConfig((c) => ({
      ...c,
      questions: [
        ...c.questions,
        {
          id: `q_${Date.now().toString(36)}`,
          title: "New question",
          type: "noul",
          instructions: "",
          options: templateOptions("noul"),
        },
      ],
    }));

  return (
    <Card>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-base">Jev labels</CardTitle>
          <Switch
            id="jevEnabled"
            checked={config.enabled}
            onCheckedChange={(checked) => updateConfig((c) => ({ ...c, enabled: checked }))}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Ask TypeSafe&apos;s Jev model (through OpenRouter) your own questions about each report. The answer changes the
          dot&apos;s shape and shows in its tooltip. No report is ever hidden, and device colors stay as they are.
        </p>
      </CardHeader>

      {config.enabled && (
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="jevUserKey">Your OpenRouter key</Label>
            <Input
              id="jevUserKey"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={config.userApiKey}
              placeholder="sk-or-v1-…"
              onChange={(e) => updateConfig((c) => ({ ...c, userApiKey: e.target.value }))}
            />
            <span className="text-xs text-muted-foreground">
              Jev calls are paid from this key. Create one at{" "}
              <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="underline">
                openrouter.ai/keys
              </a>{" "}
              (a credit limit on the key is a good idea). It&apos;s stored on this device only, isn&apos;t included in
              share links, and passes through this site&apos;s server to OpenRouter without being saved or logged.
            </span>
          </div>

          <details className="group rounded-md border border-border px-3 py-2 text-sm" open={!!config.accessToken}>
            <summary className="cursor-pointer select-none text-xs text-muted-foreground">
              Running this site? Use the shared key instead
            </summary>
            <div className="mt-3 flex flex-col gap-2">
              <Label htmlFor="jevToken">Owner access token</Label>
              <Input
                id="jevToken"
                type="password"
                autoComplete="off"
                value={config.accessToken}
                placeholder="Same value as JEV_ACCESS_TOKEN on the server"
                onChange={(e) => updateConfig((c) => ({ ...c, accessToken: e.target.value }))}
              />
              <span className="text-xs text-muted-foreground">
                Uses the server&apos;s own OPENROUTER_API_KEY. Only applies while the field above is empty.
              </span>
            </div>
          </details>

          <p className="-mt-2 text-xs">
            Paid by:{" "}
            <span className="font-medium">
              {config.userApiKey.trim()
                ? "your own OpenRouter key"
                : config.accessToken
                  ? "the site owner's shared key"
                  : "nobody yet, add your key above"}
            </span>
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="jevMaxCost">Max cost per run ($)</Label>
              <Input
                id="jevMaxCost"
                type="number"
                inputMode="decimal"
                min={0}
                step={0.01}
                value={config.maxCostPerRunUsd}
                onChange={(e) =>
                  updateConfig((c) => ({ ...c, maxCostPerRunUsd: Math.max(0, Number(e.target.value) || 0) }))
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="jevMaxReports">Max reports per run</Label>
              <Input
                id="jevMaxReports"
                type="number"
                inputMode="numeric"
                min={1}
                step={100}
                value={config.maxReportsPerRun}
                onChange={(e) =>
                  updateConfig((c) => ({ ...c, maxReportsPerRun: Math.max(1, Math.round(Number(e.target.value) || 1)) }))
                }
              />
            </div>
            <p className="col-span-2 text-xs text-muted-foreground">
              A run that would go over either limit is skipped completely, nothing is sent. {JEV_MODEL} costs $
              {JEV_PRICE_PER_M_INPUT_TOKENS} per million input tokens; three questions take about 1,000 tokens per report,
              so roughly $0.04 per 1,000 reports. Each report is asked once per question.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            <span>Spent on this device: {formatUsd(config.spentUsd)}</span>
            <button className="underline" onClick={() => updateConfig((c) => ({ ...c, spentUsd: 0 }))}>
              Reset
            </button>
            <span>Cached answers: {cacheSize.toLocaleString()}</span>
            <button
              className="underline"
              onClick={() => {
                clearJevCache();
                setCacheSize(0);
              }}
            >
              Clear cache
            </button>
          </div>

          <div className="flex flex-col gap-2">
            <Label>Questions</Label>
            <Accordion type="single" collapsible className="rounded-md border border-border">
              {config.questions.map((q) => (
                <QuestionEditor
                  key={q.id}
                  question={q}
                  onChange={(patch) => setQuestion(q.id, patch)}
                  onDelete={() =>
                    updateConfig((c) => ({
                      ...c,
                      questions: c.questions.filter((x) => x.id !== q.id),
                      activeQuestionId: c.activeQuestionId === q.id ? null : c.activeQuestionId,
                    }))
                  }
                />
              ))}
            </Accordion>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={addQuestion}
                disabled={config.questions.length >= JEV_MAX_QUESTIONS}
              >
                <Plus className="h-3.5 w-3.5" /> Add question
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  updateConfig((c) => ({ ...c, questions: DEFAULT_JEV_QUESTIONS, activeQuestionId: "glitch" }))
                }
              >
                <RotateCcw className="h-3.5 w-3.5" /> Restore example questions
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Jev sees each report&apos;s time, accuracy and Apple confidence, the same facts for the 3 reports before and
              after it (minutes apart, distance and direction in metres, minimum speed), and a 30-minute summary. Never
              coordinates. Ask things those facts can answer.
            </p>
          </div>
        </CardContent>
      )}
    </Card>
  );
}

function QuestionEditor({
  question: q,
  onChange,
  onDelete,
}: {
  question: JevQuestionConfig;
  onChange: (patch: (q: JevQuestionConfig) => JevQuestionConfig) => void;
  onDelete: () => void;
}) {
  const problem = validateQuestion(q);

  const setOption = (key: string, patch: Partial<JevAnswerOption>) =>
    onChange((cur) => ({
      ...cur,
      // Keys stay fixed once created: renaming a label is display-only and doesn't invalidate cached answers.
      // What Jev sees is the description.
      options: cur.options.map((o) => (o.key === key ? { ...o, ...patch } : o)),
    }));

  const canEditAnswers = q.type !== "noul";

  return (
    <AccordionItem value={q.id} className="border-border px-3 last:border-b-0">
      <AccordionTrigger className="py-3 text-sm hover:no-underline">
        <span className="flex min-w-0 items-center gap-2 text-left">
          {problem && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />}
          <span className="truncate">{q.title || "Untitled"}</span>
          <span className="shrink-0 text-xs font-normal text-muted-foreground">{TYPE_LABELS[q.type]}</span>
        </span>
      </AccordionTrigger>
      <AccordionContent className="flex flex-col gap-3 pb-4">
        {problem && <p className="text-xs text-destructive">{problem}. This question is skipped until fixed.</p>}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Short title (shown on the map)</Label>
            <Input value={q.title} maxLength={24} onChange={(e) => onChange((c) => ({ ...c, title: e.target.value }))} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label className="text-xs">Answer type</Label>
            <Select
              value={q.type}
              onValueChange={(v) =>
                onChange((c) => ({ ...c, type: v as JevQuestionType, options: templateOptions(v as JevQuestionType) }))
              }
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(TYPE_LABELS) as JevQuestionType[]).map((t) => (
                  <SelectItem key={t} value={t}>
                    {TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label className="text-xs">Question for Jev</Label>
          <Textarea
            rows={2}
            value={q.instructions}
            placeholder="e.g. Does this report look like the tag was on a train?"
            onChange={(e) => onChange((c) => ({ ...c, instructions: e.target.value }))}
          />
        </div>

        <div className="flex flex-col gap-2">
          <Label className="text-xs">
            {q.type === "score" ? "Levels, lowest first" : "Answers"} and their dot shape
          </Label>
          {q.options.map((o, i) => (
            <div key={i} className="flex flex-col gap-1.5 rounded-md border border-border p-2">
              <div className="flex items-center gap-2">
                <Input
                  className="h-8 flex-1"
                  value={o.label}
                  maxLength={32}
                  onChange={(e) => setOption(o.key, { label: e.target.value })}
                />
                <MarkSelect value={o.mark} onChange={(mark) => setOption(o.key, { mark })} />
                {canEditAnswers && q.options.length > 2 && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 shrink-0"
                    aria-label={`Remove ${o.label}`}
                    onClick={() =>
                      onChange((c) => {
                        const options = c.options.filter((x) => x.key !== o.key);
                        // Score keys are level indexes, so renumber after removing one.
                        return {
                          ...c,
                          options: c.type === "score" ? options.map((x, i) => ({ ...x, key: String(i) })) : options,
                        };
                      })
                    }
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
              {q.type === "noul" && o.key === "unsure" ? (
                <span className="text-xs text-muted-foreground">
                  Used when Jev&apos;s yes-probability is between 35% and 65%.
                </span>
              ) : (
                <Textarea
                  rows={2}
                  className="text-xs"
                  value={o.description}
                  placeholder="What this answer means, in plain words"
                  onChange={(e) => setOption(o.key, { description: e.target.value })}
                />
              )}
            </div>
          ))}
          {canEditAnswers && q.options.length < (q.type === "score" ? 10 : 16) && (
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() =>
                onChange((c) => {
                  const label = c.type === "score" ? `Level ${c.options.length}` : `Answer ${c.options.length + 1}`;
                  const key =
                    c.type === "score" ? String(c.options.length) : slugKey(label, c.options.map((x) => x.key));
                  return { ...c, options: [...c.options, { key, label, description: "", mark: "dot" }] };
                })
              }
            >
              <Plus className="h-3.5 w-3.5" /> Add {q.type === "score" ? "level" : "answer"}
            </Button>
          )}
        </div>

        <Button variant="ghost" size="sm" className="self-start text-destructive" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" /> Delete question
        </Button>
      </AccordionContent>
    </AccordionItem>
  );
}

function MarkSelect({ value, onChange }: { value: JevMark; onChange: (m: JevMark) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as JevMark)}>
      <SelectTrigger className="h-8 w-[3.75rem] shrink-0 px-2" aria-label="Dot shape">
        <MarkIcon mark={value} color="currentColor" />
      </SelectTrigger>
      <SelectContent>
        {JEV_MARKS.map((m) => (
          <SelectItem key={m.value} value={m.value}>
            <span className="flex items-center gap-2">
              <MarkIcon mark={m.value} color="currentColor" />
              {m.label}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
