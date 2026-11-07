"use client";

import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import OpenRouterSettingsCard from "@/components/openrouter-settings-card";
import AiChatSettingsCard from "@/components/ai-chat-settings-card";

/** AI settings in one card: the OpenRouter key and the chat. */
export default function AiSettingsCard() {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">AI</CardTitle>
        <p className="text-xs text-muted-foreground">
          Ask questions about your tags on the map, through OpenRouter. Open the chat with the AI button.
        </p>
      </CardHeader>
      <OpenRouterSettingsCard embedded />
      <AiChatSettingsCard embedded />
    </Card>
  );
}
