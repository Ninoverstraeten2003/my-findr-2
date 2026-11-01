import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";

/** A settings card on its own, or a section inside a combined card (e.g. the AI card). */
export function SettingsShell({ embedded, children }: { embedded?: boolean; children: ReactNode }) {
  return embedded ? <div className="border-t border-border first:border-t-0">{children}</div> : <Card>{children}</Card>;
}
