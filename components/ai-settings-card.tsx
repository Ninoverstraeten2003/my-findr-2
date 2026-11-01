"use client";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import OpenRouterSettingsCard from "@/components/openrouter-settings-card";
import JevSettingsCard from "@/components/jev-settings-card";
import AiChatSettingsCard from "@/components/ai-chat-settings-card";

/** All AI settings in one card: the OpenRouter key, Jev labels and the chat share it. */
export default function AiSettingsCard() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">AI</CardTitle>
        <p className="text-xs text-muted-foreground">
          Labels (Jev) and Ask (chat) on the map, both through OpenRouter. Open them with the AI button.
        </p>
      </CardHeader>
      <OpenRouterSettingsCard embedded />
      <JevSettingsCard embedded />
      <AiChatSettingsCard embedded />
    </Card>
  );
}
