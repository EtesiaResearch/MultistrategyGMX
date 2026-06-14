import type { JSX } from "react";
import { cn } from "@/lib/utils";

/** Loading placeholder in `surface` — keeps layout stable while data loads. */
export function Skeleton({ className }: { readonly className?: string }): JSX.Element {
  return (
    <div aria-hidden className={cn("motion-safe:animate-pulse rounded-md bg-surface", className)} />
  );
}
