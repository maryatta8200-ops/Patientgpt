/**
 * A minimal Apps Script runtime.
 *
 * `apps-script/Code.gs` has never been executed by a browser or by Google in this
 * repository, so it is loaded here into a sandbox with faithful fakes of the four
 * services it uses — Sheets, Properties, Lock and Content — plus Utilities.
 *
 * This is deliberately not a full Apps Script emulator: it implements exactly the
 * surface Code.gs touches, which is what makes the relay's protocol testable.
 */

import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
export const CODE_PATH = join(here, '..', '..', 'apps-script', 'Code.gs');

/* ------------------------------------------------------------------ sheets */

type Cell = unknown;

class FakeSheet {
  name: string;
  rows: Cell[][] = [];
  frozen = 0;

  constructor(name: string) {
    this.name = name;
  }

  getLastRow() {
    return this.rows.length;
  }

  getLastColumn() {
    return this.rows.reduce((max, row) => Math.max(max, row.length), 0);
  }

  appendRow(values: Cell[]) {
    this.rows.push([...values]);
  }

  deleteRow(rowNumber: number) {
    if (rowNumber < 1 || rowNumber > this.rows.length) {
      throw new Error(`deleteRow out of range: ${rowNumber}`);
    }
    this.rows.splice(rowNumber - 1, 1);
  }

  deleteRows(start: number, howMany: number) {
    this.rows.splice(start - 1, howMany);
  }

  setFrozenRows(n: number) {
    this.frozen = n;
  }

  getRange(row: number, col: number, numRows = 1, numCols = 1) {
    const sheet = this;
    const read = (): Cell[][] =>
      Array.from({ length: numRows }, (_, r) =>
        Array.from({ length: numCols }, (_, c) => sheet.rows[row - 1 + r]?.[col - 1 + c] ?? ''),
      );

    const range = {
      getValues: read,
      getValue: () => read()[0][0],
      setValues(values: Cell[][]) {
        values.forEach((valueRow, r) => {
          const target = sheet.rows[row - 1 + r] ?? (sheet.rows[row - 1 + r] = []);
          valueRow.forEach((value, c) => {
            target[col - 1 + c] = value;
          });
        });
        return range;
      },
      setValue(value: Cell) {
        const target = sheet.rows[row - 1] ?? (sheet.rows[row - 1] = []);
        target[col - 1] = value;
        return range;
      },
      setFontWeight: () => range,
      setBackground: () => range,
      setFontColor: () => range,
    };
    return range;
  }
}

class FakeSpreadsheet {
  sheets = new Map<string, FakeSheet>();
  ui = {
    alerts: [] as string[],
    promptAnswers: [] as string[],
    prompts: [] as string[],
    alert(message: string) {
      this.alerts.push(message);
    },
    prompt(_title: string, message: string) {
      this.prompts.push(message);
      const next = this.promptAnswers.shift() ?? '';
      return { getSelectedButton: () => 'OK', getResponseText: () => next };
    },
    ButtonSet: { OK: 'OK', OK_CANCEL: 'OK_CANCEL' },
    createMenu: () => {
      const menu = {
        addItem: () => menu,
        addSeparator: () => menu,
        addToUi: () => menu,
      };
      return menu;
    },
  };

  getSheetByName(name: string) {
    return this.sheets.get(name) ?? null;
  }

  insertSheet(name: string) {
    const sheet = new FakeSheet(name);
    this.sheets.set(name, sheet);
    return sheet;
  }

  /** Test helper: fetch a sheet and its rows. */
  sheet(name: string) {
    const sheet = this.getSheetByName(name);
    if (!sheet) throw new Error(`No such sheet: ${name}`);
    return sheet;
  }
}

/* ------------------------------------------------------------------ crypto */

/** GAS `computeDigest` returns signed bytes (-128…127); mirror that exactly. */
function signedBytes(buffer: Buffer): number[] {
  return [...buffer].map((b) => (b > 127 ? b - 256 : b));
}

/* ------------------------------------------------------------------ loader */

export interface GasHarness {
  ss: FakeSpreadsheet;
  props: Map<string, string>;
  api: Record<string, (...args: never[]) => unknown> & {
    doPost: (e: { postData?: { contents: string } }) => { content: string };
    doGet: () => { content: string };
    setupPulse: () => string;
    purgeExpired: () => void;
  };
  /** POST a JSON action and parse the JSON reply. */
  post: (payload: Record<string, unknown>) => Record<string, unknown>;
  /** Read a sheet as an array of objects keyed by its header row. */
  table: (name: string) => Record<string, unknown>[];
}

export function loadGas(): GasHarness {
  const source = readFileSync(CODE_PATH, 'utf8');
  const ss = new FakeSpreadsheet();
  const props = new Map<string, string>();
  const lock = { held: false };

  const Utilities = {
    DigestAlgorithm: { SHA_256: 'SHA_256' },
    Charset: { UTF_8: 'UTF_8' },
    computeDigest(_algorithm: string, value: string) {
      return signedBytes(createHash('sha256').update(String(value), 'utf8').digest());
    },
    getUuid: () => randomUUID(),
    formatDate(date: Date) {
      return date.toISOString().slice(0, 10);
    },
  };

  const PropertiesService = {
    getScriptProperties: () => ({
      getProperty: (key: string) => props.get(key) ?? null,
      setProperty: (key: string, value: string) => {
        props.set(key, String(value));
      },
      deleteProperty: (key: string) => {
        props.delete(key);
      },
    }),
  };

  const ContentService = {
    MimeType: { JSON: 'application/json', TEXT: 'text/plain' },
    createTextOutput(content: string) {
      const out = {
        content,
        mimeType: 'text/plain',
        setMimeType(mime: string) {
          out.mimeType = mime;
          return out;
        },
        getContent() {
          return content;
        },
      };
      return out;
    },
  };

  const LockService = {
    getScriptLock: () => ({
      tryLock: () => {
        lock.held = true;
        return true;
      },
      releaseLock: () => {
        lock.held = false;
      },
      waitLock: () => true,
      hasLock: () => lock.held,
    }),
  };

  const SpreadsheetApp = {
    getActiveSpreadsheet: () => ss,
    getUi: () => ss.ui,
  };

  const ScriptApp = {
    getProjectTriggers: () => [] as Array<{ getHandlerFunction: () => string }>,
    deleteTrigger: () => undefined,
    newTrigger: () => ({
      timeBased: () => ({
        everyMinutes: () => ({ create: () => ({}) }),
      }),
    }),
    getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }),
  };

  const Session = { getScriptTimeZone: () => 'UTC' };
  const UrlFetchApp = { fetch: () => ({ getResponseCode: () => 200 }) };
  const Logger = { log: () => undefined };

  const factory = new Function(
    'Utilities',
    'PropertiesService',
    'ContentService',
    'LockService',
    'SpreadsheetApp',
    'ScriptApp',
    'Session',
    'UrlFetchApp',
    'Logger',
    `${source}
     return { doGet, doPost, setupPulse, purgeExpired, onOpen, healthCheck,
              health_, register_, ask_, poll_, ack_, ping_, deregister_,
              adminInbox_, adminReply_, sha256Hex_, isUuid_, sanitiseAlias_,
              ttlMinutes_, autoAckText_, deleteMailboxRows_, findRegistryRow_ };`,
  );

  const api = factory(
    Utilities,
    PropertiesService,
    ContentService,
    LockService,
    SpreadsheetApp,
    ScriptApp,
    Session,
    UrlFetchApp,
    Logger,
  );

  const post = (payload: Record<string, unknown>) => {
    const result = api.doPost({ postData: { contents: JSON.stringify(payload) } });
    return JSON.parse(result.content);
  };

  const table = (name: string) => {
    const sheet = ss.sheet(name);
    if (!sheet.rows.length) return [];
    const [headers, ...body] = sheet.rows;
    return body.map((row) =>
      Object.fromEntries(headers.map((header, i) => [String(header), row[i] ?? ''])),
    );
  };

  return { ss, props, api, post, table };
}

export const SHEETS = {
  registry: 'Pulse · Registry',
  mailbox: 'Pulse · Mailbox',
  log: 'Pulse · Log',
};
