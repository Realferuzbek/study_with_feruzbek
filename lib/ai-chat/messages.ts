import type { LeaderboardScope } from "@/types/leaderboard";
import type { SupportedLanguage } from "./language";

const OFF_TOPIC_RESPONSES: Record<SupportedLanguage, string[]> = {
  en: [
    "I can only answer questions about Focus Squad and its features. Try asking about the dashboard, timer, leaderboard, or how to use a feature.",
  ],
  uz: [
    "I can only answer questions about Focus Squad and its features. Try asking about the dashboard, timer, leaderboard, or how to use a feature.",
  ],
  ru: [
    "I can only answer questions about Focus Squad and its features. Try asking about the dashboard, timer, leaderboard, or how to use a feature.",
  ],
};

const MODERATION_RESPONSES: Record<SupportedLanguage, string[]> = {
  en: [
    "I want to keep things positive and on-topic, so let’s stick to questions about this site.",
  ],
  uz: [
    "Hammasi xavfsiz qolishi uchun, iltimos, shu saytga oid mavzular bilan davom etamiz.",
  ],
  ru: [
    "Поддерживаю только спокойные и безопасные темы. Давай обсудим что-нибудь по сайту.",
  ],
};

const ERROR_RESPONSES: Record<SupportedLanguage, string[]> = {
  en: [
    "Uh oh, something glitchy happened. Ask me again in a moment and I’ll be ready!",
  ],
  uz: [
    "Afsuski, kichik nosozlik yuz berdi. Birozdan so‘ng yana so‘rab ko‘ring!",
  ],
  ru: [
    "Поймал глюк. Спроси ещё раз через минутку — я снова буду в строю!",
  ],
};

const PERSONAL_DATA_RESPONSES: Record<SupportedLanguage, string[]> = {
  en: [
    "I can't access personal data (your stats/tasks/habits). I can help explain features or public info like the leaderboard.",
  ],
  uz: [
    "I can't access personal data (your stats/tasks/habits). I can help explain features or public info like the leaderboard.",
  ],
  ru: [
    "I can't access personal data (your stats/tasks/habits). I can help explain features or public info like the leaderboard.",
  ],
};

const ADMIN_REFUSAL_RESPONSES: Record<SupportedLanguage, string[]> = {
  en: ["I can't access admin-only or internal system info."],
  uz: ["I can't access admin-only or internal system info."],
  ru: ["I can't access admin-only or internal system info."],
};

const SIGN_IN_REQUIRED_RESPONSES: Record<SupportedLanguage, string[]> = {
  en: ["Please sign in to see your personal StudyMate info."],
  uz: ["Shaxsiy StudyMate ma'lumotlari uchun tizimga kiring."],
  ru: ["Войдите в аккаунт, чтобы увидеть личные данные StudyMate."],
};

const LEADERBOARD_MISSING_DATE: Record<SupportedLanguage, string[]> = {
  en: [
    "I can check a leaderboard snapshot if you share a date (YYYY-MM-DD).",
  ],
  uz: [
    "Leaderboardni faqat sana bilan tekshira olaman (YYYY-MM-DD). Sanani yuborsangiz, tekshirib beraman.",
  ],
  ru: [
    "Я могу проверить лидерборд по дате (YYYY-MM-DD). Пришлите дату, и я посмотрю.",
  ],
};

const LEADERBOARD_MISSING_RANK: Record<SupportedLanguage, string[]> = {
  en: ["Which rank or top list should I check (for example, 2nd place or top 10)?"],
  uz: ["Which rank or top list should I check (for example, 2nd place or top 10)?"],
  ru: ["Which rank or top list should I check (for example, 2nd place or top 10)?"],
};

const LEADERBOARD_NOT_FOUND: Record<SupportedLanguage, string[]> = {
  en: [
    "I can't access that leaderboard snapshot yet. Open Leaderboard -> History and pick the date and scope.",
  ],
  uz: [
    "I can't access that leaderboard snapshot yet. Open Leaderboard -> History and pick the date and scope.",
  ],
  ru: [
    "I can't access that leaderboard snapshot yet. Open Leaderboard -> History and pick the date and scope.",
  ],
};

const LEADERBOARD_SCOPE_LABELS: Record<
  SupportedLanguage,
  Record<LeaderboardScope, string>
> = {
  en: { day: "Daily", week: "Weekly", month: "Monthly" },
  uz: { day: "Kunlik", week: "Haftalik", month: "Oylik" },
  ru: { day: "Ежедневный", week: "Еженедельный", month: "Ежемесячный" },
};

export function getOffTopicResponse(language: SupportedLanguage) {
  return pick(OFF_TOPIC_RESPONSES, language);
}

export function getModerationResponse(language: SupportedLanguage) {
  return pick(MODERATION_RESPONSES, language);
}

export function getErrorResponse(language: SupportedLanguage) {
  return pick(ERROR_RESPONSES, language);
}

export function getPersonalDataRefusalResponse(language: SupportedLanguage) {
  return pick(PERSONAL_DATA_RESPONSES, language);
}

export function getAdminRefusalResponse(language: SupportedLanguage) {
  return pick(ADMIN_REFUSAL_RESPONSES, language);
}

export function getSignInRequiredResponse(language: SupportedLanguage) {
  return pick(SIGN_IN_REQUIRED_RESPONSES, language);
}

export function getLeaderboardMissingDateResponse(
  language: SupportedLanguage,
) {
  return pick(LEADERBOARD_MISSING_DATE, language);
}

export function getLeaderboardMissingRankResponse(
  language: SupportedLanguage,
) {
  return pick(LEADERBOARD_MISSING_RANK, language);
}

export function getLeaderboardNotFoundResponse(
  language: SupportedLanguage,
) {
  return pick(LEADERBOARD_NOT_FOUND, language);
}

export function getLeaderboardScopeLabel(
  scope: LeaderboardScope,
  language: SupportedLanguage,
) {
  const labels = LEADERBOARD_SCOPE_LABELS[language] ?? LEADERBOARD_SCOPE_LABELS.en;
  return labels[scope] ?? scope;
}

function pick(
  source: Record<SupportedLanguage, string[]>,
  language: SupportedLanguage,
) {
  const options = source[language]?.length
    ? source[language]
    : source.en ?? [];
  if (!options.length) return "";
  const index = Math.floor(Math.random() * options.length);
  return options[index];
}
