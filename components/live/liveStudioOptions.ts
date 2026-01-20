import type { LucideIcon } from "lucide-react";
import { Footprints, Monitor, Shuffle } from "lucide-react";

export type StudioTask = "desk" | "moving" | "anything";

export type TaskOption = {
  value: StudioTask;
  label: string;
  icon: LucideIcon;
};

export const TASK_OPTIONS: TaskOption[] = [
  { value: "desk", label: "Desk", icon: Monitor },
  { value: "moving", label: "Moving", icon: Footprints },
  { value: "anything", label: "Anything", icon: Shuffle },
];

export const DURATION_OPTIONS = [30, 60, 120] as const;
