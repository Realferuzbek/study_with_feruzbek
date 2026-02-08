import { supabaseAdmin } from "@/lib/supabaseServer";

export type FocusSessionSeatClaimRole = "host" | "participant";

export type FocusSessionSeatClaimCode =
  | "reserved"
  | "already_participant"
  | "session_full"
  | "host_conflict"
  | "active_conflict"
  | "overlap_conflict"
  | "session_unavailable"
  | "not_found"
  | "invalid_role"
  | "error";

export type FocusSessionSeatClaimResult = {
  code: FocusSessionSeatClaimCode;
  participantCount: number | null;
  maxParticipants: number | null;
  myRole: FocusSessionSeatClaimRole | null;
  sessionStatus: string | null;
};

const SUCCESS_CODES: FocusSessionSeatClaimCode[] = [
  "reserved",
  "already_participant",
];

function readRecordValue(
  record: Record<string, unknown>,
  keys: string[],
): unknown {
  for (const key of keys) {
    if (key in record) {
      return record[key];
    }
  }
  return undefined;
}

function toNullableInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.floor(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.floor(parsed);
    }
  }
  return null;
}

function toSeatRole(value: unknown): FocusSessionSeatClaimRole | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "host" || normalized === "participant") {
    return normalized;
  }
  return null;
}

function toCode(value: unknown): FocusSessionSeatClaimCode {
  if (typeof value !== "string") return "error";
  const normalized = value.trim().toLowerCase();
  if (
    normalized === "reserved" ||
    normalized === "already_participant" ||
    normalized === "session_full" ||
    normalized === "host_conflict" ||
    normalized === "active_conflict" ||
    normalized === "overlap_conflict" ||
    normalized === "session_unavailable" ||
    normalized === "not_found" ||
    normalized === "invalid_role"
  ) {
    return normalized;
  }
  return "error";
}

function toSessionStatus(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.toLowerCase() : null;
}

function parseSeatClaimResult(payload: unknown): FocusSessionSeatClaimResult {
  const record =
    payload && typeof payload === "object"
      ? (payload as Record<string, unknown>)
      : {};

  return {
    code: toCode(readRecordValue(record, ["code", "status", "result"])),
    participantCount: toNullableInt(
      readRecordValue(record, ["participant_count", "participantCount"]),
    ),
    maxParticipants: toNullableInt(
      readRecordValue(record, ["max_participants", "maxParticipants"]),
    ),
    myRole: toSeatRole(readRecordValue(record, ["my_role", "myRole", "role"])),
    sessionStatus: toSessionStatus(
      readRecordValue(record, ["session_status", "sessionStatus"]),
    ),
  };
}

export function isSeatClaimSuccess(code: FocusSessionSeatClaimCode) {
  return SUCCESS_CODES.includes(code);
}

export function mapSeatClaimCodeToHttpStatus(code: FocusSessionSeatClaimCode) {
  switch (code) {
    case "not_found":
      return 404;
    case "reserved":
    case "already_participant":
      return 200;
    case "session_full":
    case "host_conflict":
    case "active_conflict":
    case "overlap_conflict":
    case "session_unavailable":
      return 409;
    case "invalid_role":
      return 400;
    default:
      return 500;
  }
}

export function seatClaimMessage(code: FocusSessionSeatClaimCode) {
  switch (code) {
    case "reserved":
      return "Seat reserved.";
    case "already_participant":
      return "You're already reserved for this session.";
    case "session_full":
      return "Session is full.";
    case "host_conflict":
      return "Hosts are already part of this session.";
    case "active_conflict":
      return "You already have an active session.";
    case "overlap_conflict":
      return "You already have another session at this time.";
    case "session_unavailable":
      return "Session is not available.";
    case "not_found":
      return "Session not found.";
    case "invalid_role":
      return "Invalid seat role.";
    default:
      return "Failed to reserve seat.";
  }
}

export async function claimFocusSessionSeat(params: {
  sessionId: string;
  userId: string;
  role: FocusSessionSeatClaimRole;
}) {
  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc("focus_session_claim_seat", {
    p_session_id: params.sessionId,
    p_user_id: params.userId,
    p_role: params.role,
  });

  if (error) {
    return {
      result: {
        code: "error" as const,
        participantCount: null,
        maxParticipants: null,
        myRole: null,
        sessionStatus: null,
      },
      error,
    };
  }

  return {
    result: parseSeatClaimResult(data),
    error: null,
  };
}
