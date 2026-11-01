"use client";

import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingsShell } from "@/components/settings-shell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CHAT_MODELS } from "@/lib/ai-chat-models";
import { formatUsd } from "@/lib/jev";
import { useAiChatConfig } from "@/lib/use-ai-chat-config";

const OTHER = "__other__";

export default function AiChatSettingsCard({ embedded = false }: { embedded?: boolean } = {}) {
  const [config, updateConfig] = useAiChatConfig();
  const known = CHAT_MODELS.some((m) => m.id === config.model);

  return (
    <SettingsShell embedded={embedded}>
      <CardHeader className="pb-4">
        <div className="flex items-center justify-between gap-4">
          <CardTitle className="text-sm">Ask (chat)</CardTitle>
          <Switch
            id="aiChatEnabled"
            checked={config.enabled}
            onCheckedChange={(checked) => updateConfig((c) => ({ ...c, enabled: checked }))}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          Ask questions about where your tags went. The AI reads your reports through tools in this browser and can
          draw a path on the map (through the real reports, along roads where it makes sense). Report coordinates are
          sent to the model provider with zero data retention.
        </p>
      </CardHeader>

      {config.enabled && (
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label>Model</Label>
            <Select
              value={known ? config.model : OTHER}
              onValueChange={(v) => updateConfig((c) => ({ ...c, model: v === OTHER ? "" : v }))}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CHAT_MODELS.map((m) => (
                  <SelectItem key={m.id} value={m.id}>
                    {m.label} · {m.measured}
                  </SelectItem>
                ))}
                <SelectItem value={OTHER}>Other OpenRouter model (own key only)</SelectItem>
              </SelectContent>
            </Select>
            {!known && (
              <Input
                value={config.model}
                placeholder="provider/model-name, e.g. qwen/qwen3.8-flash"
                spellCheck={false}
                autoCapitalize="none"
                onChange={(e) => updateConfig((c) => ({ ...c, model: e.target.value.trim() }))}
              />
            )}
            <span className="text-xs text-muted-foreground">
              Costs and times measured on a typical question in this app. Other models need your own OpenRouter key,
              tool calling and a zero-data-retention provider.
            </span>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="aiChatMaxCost">Max cost per conversation ($)</Label>
            <Input
              id="aiChatMaxCost"
              type="number"
              inputMode="decimal"
              min={0}
              step={0.01}
              value={config.maxCostPerChatUsd}
              onChange={(e) =>
                updateConfig((c) => ({ ...c, maxCostPerChatUsd: Math.max(0, Number(e.target.value) || 0) }))
              }
            />
          </div>

          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-muted-foreground">
            <span>Spent on this device: {formatUsd(config.spentUsd)}</span>
            <button className="underline" onClick={() => updateConfig((c) => ({ ...c, spentUsd: 0 }))}>
              Reset
            </button>
          </div>
        </CardContent>
      )}
    </SettingsShell>
  );
}
