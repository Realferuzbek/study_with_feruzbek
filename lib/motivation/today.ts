import { DateTime } from "luxon";
import { MOTIVATION_QUOTES, MOTIVATION_COUNT } from "@/data/motivations";

const TASHKENT_ZONE = "Asia/Tashkent";
const ANCHOR_DATE_ISO = "2025-01-01";

export type MotivationSnapshot = {
  dateLabel: string;
  quote: string;
  index: number;
  cycle: number;
  dateISO: string;
};

function computeRotation(target: DateTime): { index: number; cycle: number } {
  const anchor = DateTime.fromISO(ANCHOR_DATE_ISO, {
    zone: TASHKENT_ZONE,
  }).startOf("day");
  const daysOffset = Math.floor(
    target.startOf("day").diff(anchor, "days").days,
  );
  const normalized =
    ((daysOffset % MOTIVATION_COUNT) + MOTIVATION_COUNT) % MOTIVATION_COUNT;
  const cycle = Math.floor(daysOffset / MOTIVATION_COUNT) + 1;
  return { index: normalized, cycle };
}

export function buildMotivationSnapshot(target: DateTime): MotivationSnapshot {
  const { index, cycle } = computeRotation(target);
  const quote = MOTIVATION_QUOTES[index];
  const dateLabel = target.toFormat("cccc, d LLLL");
  const dateISO = target.toFormat("yyyy-LL-dd");
  return { dateLabel, quote, index, cycle, dateISO };
}

export function getTodayMotivationSnapshot(): MotivationSnapshot {
  const now = DateTime.now().setZone(TASHKENT_ZONE);
  return buildMotivationSnapshot(now);
}

export function getMotivationTimeZone() {
  return TASHKENT_ZONE;
}
