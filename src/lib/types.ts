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
