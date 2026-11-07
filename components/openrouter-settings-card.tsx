"use client";

import { CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SettingsShell } from "@/components/settings-shell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useOpenRouterConfig } from "@/lib/use-openrouter-config";

/** The OpenRouter key (or owner token) that pays for the AI chat. */
export default function OpenRouterSettingsCard({ embedded = false }: { embedded?: boolean } = {}) {
  const [config, updateConfig] = useOpenRouterConfig();
  return (
    <SettingsShell embedded={embedded}>
      <CardHeader className="pb-4">
        <CardTitle className="text-sm">OpenRouter key</CardTitle>
        <p className="text-xs text-muted-foreground">
          The AI chat runs through OpenRouter with zero data retention.
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="openRouterKey">Your OpenRouter key</Label>
            <Input
              id="openRouterKey"
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={config.userApiKey}
              placeholder="sk-or-v1-…"
              onChange={(e) => updateConfig((c) => ({ ...c, userApiKey: e.target.value }))}
            />
            <span className="text-xs text-muted-foreground">
              The AI chat is paid from this key. Create one at{" "}
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
              <Label htmlFor="ownerToken">Owner access token</Label>
              <Input
                id="ownerToken"
                type="password"
                autoComplete="off"
                value={config.accessToken}
                placeholder="Same value as OWNER_ACCESS_TOKEN on the server"
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
      </CardContent>
    </SettingsShell>
  );
}
