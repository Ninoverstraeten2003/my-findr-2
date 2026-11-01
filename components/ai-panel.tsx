"use client";

import { Loader2, Sparkles } from "lucide-react";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { cn } from "@/lib/utils";
import { JevLabelsBody } from "@/components/jev-panel";
import { AiChatBody } from "@/components/ai-chat-panel";
import type { JevConfig } from "@/lib/jev";
import type { AiPath } from "@/lib/ai-tools";
import type { AiChatConfig } from "@/lib/use-ai-chat-config";
import type { AiChatSession } from "@/lib/use-ai-chat-session";
import type { useJevLabels } from "@/lib/use-jev-labels";
import type { DeviceReport } from "@/lib/types";

export type AiTab = "ask" | "labels";

interface AiPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: AiTab;
  onTabChange: (tab: AiTab) => void;
  // Labels (Jev)
  jevConfig: JevConfig;
  jev: ReturnType<typeof useJevLabels>;
  reports: DeviceReport[];
  deviceName?: string;
  deviceColor: string;
  onSelectQuestion: (id: string | null) => void;
  onFocusReport: (key: string) => void;
  // Ask (chat)
  chatConfig: AiChatConfig;
  session: AiChatSession;
  hasKey: boolean;
  exampleDevice: string;
  aiPath: AiPath | null;
  onDrawPath: (path: AiPath | null) => void;
  onOpenSettings: () => void;
}

/** One AI entry point on the map: the chat (Ask) and Jev labels (Labels) as tabs of one sheet. */
export default function AiPanel(props: AiPanelProps) {
  const { open, onOpenChange, jevConfig, chatConfig, jev, session } = props;
  const tabs: AiTab[] = [...(chatConfig.enabled ? (["ask"] as const) : []), ...(jevConfig.enabled ? (["labels"] as const) : [])];
  if (tabs.length === 0) return null;
  const tab = tabs.includes(props.tab) ? props.tab : tabs[0];
  const activeQuestion = jev.questions.find((q) => q.id === jevConfig.activeQuestionId);
  const close = () => onOpenChange(false);
  const openSettings = () => {
    close();
    props.onOpenSettings();
  };

  return (
    <>
      <button
        onClick={() => onOpenChange(true)}
        className="absolute bottom-6 right-4 z-[1000] flex items-center gap-1.5 rounded-full border border-border bg-card/30 px-3 py-2 text-xs font-medium text-card-foreground shadow-md backdrop-blur-md touch-none active:scale-95 transition-transform"
        aria-label="Open AI"
      >
        {jev.run.running || session.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        <span>AI</span>
        {jevConfig.enabled && activeQuestion && <span className="text-muted-foreground">· {activeQuestion.title}</span>}
        {jev.run.running && (
          <span className="tabular-nums text-muted-foreground">
            {jev.run.done}/{jev.run.total}
          </span>
        )}
      </button>

      <Drawer open={open} onOpenChange={onOpenChange} shouldScaleBackground={false}>
        <DrawerContent className="max-h-[85dvh] md:max-w-lg md:mx-auto">
          <DrawerHeader className="flex items-center justify-between gap-3 pb-2 text-left">
            <DrawerTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4" /> AI
            </DrawerTitle>
            <DrawerDescription className="sr-only">Ask about your tags, or label reports with Jev</DrawerDescription>
            {tabs.length > 1 && (
              <div className="flex rounded-full border border-border p-0.5 text-xs" role="tablist">
                {tabs.map((t) => (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => props.onTabChange(t)}
                    className={cn(
                      "rounded-full px-3 py-1 font-medium transition-colors",
                      tab === t ? "bg-foreground text-background" : "text-muted-foreground",
                    )}
                  >
                    {t === "ask" ? "Ask" : "Labels"}
                  </button>
                ))}
              </div>
            )}
          </DrawerHeader>

          {tab === "ask" ? (
            <AiChatBody
              session={session}
              config={chatConfig}
              hasKey={props.hasKey}
              exampleDevice={props.exampleDevice}
              aiPath={props.aiPath}
              onDrawPath={props.onDrawPath}
              onOpenSettings={openSettings}
            />
          ) : (
            <JevLabelsBody
              reports={props.reports}
              deviceName={props.deviceName}
              deviceColor={props.deviceColor}
              config={jevConfig}
              jev={jev}
              onSelectQuestion={props.onSelectQuestion}
              onFocusReport={props.onFocusReport}
              onOpenSettings={openSettings}
              onClose={close}
            />
          )}
        </DrawerContent>
      </Drawer>
    </>
  );
}
