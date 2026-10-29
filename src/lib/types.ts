/** Shared data model. Everything here lives on the device — never in the relay. */

export type Role = 'user' | 'agent';

export type MsgStatus =
  | 'queued' // saved locally, not yet handed to the relay (offline or retrying)
  | 'sending' // in flight to the relay
  | 'awaiting' // relay accepted it; waiting for a human/AI answer
  | 'delivered' // answer received and persisted locally
  | 'failed'; // relay rejected / unreachable

export interface Message {
  id: string;
  threadId: string;
  role: Role;
  text: string;
  createdAt: number;
  status: MsgStatus;
  /** relay row id, used for ack + burn */
  relayId?: string;
  error?: string;
  /** set when the answer was pulled from the relay */
  deliveredAt?: number;
  /** true for the instant holding reply ("our team is working on it"), not a real answer */
  auto?: boolean;
  /** for auto/status messages: the question they belong to */
  forMessageId?: string;
  /** follow-ups posted for this question (0 none, 1 nudge, 2 escalation) */
  nudgeStage?: number;
  /** which kind of holding message this is */
  autoKind?: 'ack' | 'nudge' | 'escalate';
}

export interface Thread {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  unread: number;
  archived: boolean;
}

export interface Identity {
  deviceId: string;
  /** Issued once by the relay. Stored locally only. */
  token: string;
  alias: string;
  createdAt: number;
  /** Human-readable one-time recovery code shown at registration. */
  recoveryCode: string;
}

export interface Settings {
  relayUrl: string;
  pollSeconds: number;
  pinEnabled: boolean;
  haptics: boolean;
  sandbox: boolean;
  ttlMinutes: number;
  onboarded: boolean;
  alias: string;
  lastAckAt: number;
  /** instant holding reply sent on every new question */
  autoAck: boolean;
  autoAckText: string;
  /** when to post a "still on it" nudge, in minutes (0 = never) */
  followUpMinutes: number;
  /** when to post the final escalation, in minutes (0 = never) */
  escalateMinutes: number;
  nudgeText: string;
  escalateText: string;
}

export const DEFAULT_SETTINGS: Settings = {
  relayUrl: '',
  pollSeconds: 6,
  pinEnabled: false,
  haptics: true,
  sandbox: true,
  ttlMinutes: 15,
  onboarded: false,
  alias: '',
  lastAckAt: 0,
  autoAck: true,
  autoAckText: 'Our team is working on your question.',
  followUpMinutes: 4,
  escalateMinutes: 15,
  nudgeText:
    'Still on it — your question is with the team. The answer will appear here the moment it lands.',
  escalateText:
    'This is taking longer than expected. Your question is still queued and will be answered here — you can leave this screen, it will be waiting for you.',
};

export type ConnectionState = 'sandbox' | 'online' | 'offline' | 'error' | 'unconfigured';

export interface PendingReply {
  relayId: string;
  messageId: string;
  threadId: string;
  answer: string;
  answeredAt: number;
}

export interface AdminQuestion {
  relayId: string;
  deviceId: string;
  alias: string;
  question: string;
  createdAt: number;
  status: string;
  answer?: string;
}

export interface RelayResult<T> {
  ok: boolean;
  data?: T;
  error?: string;
}
