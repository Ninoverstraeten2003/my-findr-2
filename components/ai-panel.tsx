"use client";

import { Loader2, Sparkles } from "lucide-react";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { AiChatBody } from "@/components/ai-chat-panel";
import type { AiPath } from "@/lib/ai-tools";
import type { AiChatConfig } from "@/lib/use-ai-chat-config";
import type { AiChatSession } from "@/lib/use-ai-chat-session";

interface AiPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chatConfig: AiChatConfig;
  session: AiChatSession;
  hasKey: boolean;
  exampleDevice: string;
  aiPath: AiPath | null;
  onDrawPath: (path: AiPath | null) => void;
  onOpenSettings: () => void;
}

/** The AI chat on the map: a button that opens it in a sheet. */
export default function AiPanel(props: AiPanelProps) {
  const { open, onOpenChange, chatConfig, session } = props;
  if (!chatConfig.enabled) return null;
  const openSettings = () => {
    onOpenChange(false);
    props.onOpenSettings();
  };

  return (
    <>
      <button
        onClick={() => onOpenChange(true)}
        className="absolute bottom-6 right-4 z-[1000] flex items-center gap-1.5 map-surface rounded-full px-3 py-2 text-xs font-medium touch-none active:scale-95 transition-transform"
        aria-label="Open AI chat"
      >
        {session.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
        <span>AI</span>
      </button>

      <Drawer open={open} onOpenChange={onOpenChange} shouldScaleBackground={false}>
        <DrawerContent className="max-h-[85dvh] md:max-w-lg md:mx-auto">
          <DrawerHeader className="pb-2 text-left">
            <DrawerTitle className="flex items-center gap-2 text-base">
              <Sparkles className="h-4 w-4" /> Ask about your tags
            </DrawerTitle>
            <DrawerDescription className="sr-only">Ask the AI about where your tags went</DrawerDescription>
          </DrawerHeader>
          <AiChatBody
            session={session}
            config={chatConfig}
            hasKey={props.hasKey}
            exampleDevice={props.exampleDevice}
            aiPath={props.aiPath}
            onDrawPath={props.onDrawPath}
            onOpenSettings={openSettings}
          />
        </DrawerContent>
      </Drawer>
    </>
  );
}
