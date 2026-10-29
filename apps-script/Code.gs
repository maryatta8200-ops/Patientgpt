/**
 * PULSE RELAY — Google Apps Script Web App
 * =========================================
 *
 * The Google Sheet is a dead-drop mailbox, not a database.
 *
 *   • Registry  — persistent, but holds only deviceId + SHA-256(token) + alias.
 *   • Mailbox   — transient. A question exists only between "asked" and "answered
 *                 and read". Rows are deleted on ack, and a time-driven trigger
 *                 purges anything past its TTL regardless.
 *   • Log       — counters only. No message content, ever.
 *
 * Endpoints are all POST with a JSON body, dispatched on `action`:
 *   register · ask · poll · ack · ping · deregister · adminInbox · adminReply
 *
 * The web app must be deployed as:
 *   Execute as: Me
 *   Who has access: Anyone
 *
 * Responses are JSON. The client posts `text/plain` because Apps Script cannot
 * answer CORS preflights; Google then replies with `Access-Control-Allow-Origin: *`.
 */

/* ------------------------------------------------------------------ config */

var SHEET_REGISTRY = 'Pulse · Registry';
var SHEET_MAILBOX = 'Pulse · Mailbox';
var SHEET_LOG = 'Pulse · Log';

var HEADERS_REGISTRY = [
  'deviceId',
  'tokenHash',
  'alias',
  'createdAt',
  'lastSeen',
  'asksToday',
  'dayKey',
  'status',
  'totalAsks',
  'lastAskAt',
];

var HEADERS_MAILBOX = [
  'relayId',
  'deviceId',
  'threadId',
  'localId',
  'question',
  'answer',
  'status',
  'createdAt',
  'answeredAt',
  'expiresAt',
];

var HEADERS_LOG = ['at', 'event', 'detail'];

var DEFAULT_AUTO_ACK = 'Our team is working on your question.';
var DEFAULT_NUDGE =
  'Still on it — your question is with the team. The answer will appear here the moment it lands.';
var DEFAULT_ESCALATE =
  'This is taking longer than expected. Your question is still queued and will be answered here — you can leave this screen, it will be waiting for you.';

var LIMITS = {
  questionChars: 4000,
  answerChars: 8000,
  askPerDay: 200,
  minAskIntervalMs: 1500,
  registrationsPerDay: 500,
  adminInboxMax: 100,
};

/* ------------------------------------------------------------------- router */

function doGet() {
  return json({
    ok: true,
    service: 'pulse-relay',
    version: '1.0.0',
    time: new Date().toISOString(),
    note: 'POST JSON with an action: register | ask | poll | ack | ping | adminInbox | adminReply',
  });
}

function doPost(e) {
  try {
    var payload = parseBody_(e);
    if (payload && payload.action === 'register') {
      return json(register_(payload));
    }
    var router = {
      health: health_,
      ping: ping_,
      ask: ask_,
      poll: poll_,
      ack: ack_,
      deregister: deregister_,
      adminInbox: adminInbox_,
      adminReply: adminReply_,
    };
    var handler = router[payload.action];
    if (!handler) return json(fail('Unknown action: ' + payload.action));
    return json(handler(payload));
  } catch (err) {
    // Never leak internals to the client.
    try {
      log_('error', String(err && err.message ? err.message : err).slice(0, 200));
    } catch (ignored) {}
    return json(fail('Relay error', 'Please try again in a moment.'));
  }
}

function doOptions() {
  return ContentService.createTextOutput('').setMimeType(ContentService.MimeType.TEXT);
}

/* ------------------------------------------------------------------- setup */

/** Run once from the Apps Script editor, or use the Pulse menu in the sheet. */
function setupPulse() {
  var props = PropertiesService.getScriptProperties();

  if (!props.getProperty('ADMIN_KEY')) {
    props.setProperty('ADMIN_KEY', randomKey_(32));
  }
  if (!props.getProperty('TTL_MINUTES')) {
    props.setProperty('TTL_MINUTES', '15');
  }
  if (!props.getProperty('RELAY_VERSION')) {
    props.setProperty('RELAY_VERSION', '1.0.0');
  }
  if (!props.getProperty('AUTO_ACK_TEXT')) {
    props.setProperty('AUTO_ACK_TEXT', DEFAULT_AUTO_ACK);
  }
  if (!props.getProperty('NUDGE_TEXT')) {
    props.setProperty('NUDGE_TEXT', DEFAULT_NUDGE);
  }
  if (!props.getProperty('ESCALATE_TEXT')) {
    props.setProperty('ESCALATE_TEXT', DEFAULT_ESCALATE);
  }

  ensureSheet_(SHEET_REGISTRY, HEADERS_REGISTRY);
  ensureSheet_(SHEET_MAILBOX, HEADERS_MAILBOX);
  ensureSheet_(SHEET_LOG, HEADERS_LOG);

  // Drop any previous trigger for the purger, then install a fresh one.
  ScriptApp.getProjectTriggers().forEach(function (trigger) {
    if (trigger.getHandlerFunction() === 'purgeExpired') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('purgeExpired').timeBased().everyMinutes(5).create();

  var url = ScriptApp.getService().getUrl();
  log_('setup', 'relay initialised');

  var message = [
    'Pulse relay is ready.',
    '',
    'Web App URL:',
    url || '(deploy first: Deploy → New deployment → Web app)',
    '',
    'Admin key (for the Agent Console):',
    props.getProperty('ADMIN_KEY'),
    '',
    'Keep the admin key private. Anyone with it can read and answer pending questions.',
    '',
    'TTL: ' + props.getProperty('TTL_MINUTES') + ' minutes',
    '',
    'Automatic holding reply:',
    props.getProperty('AUTO_ACK_TEXT'),
  ].join('\n');

  try {
    SpreadsheetApp.getUi().alert(message);
  } catch (err) {
    Logger.log(message);
  }
  return message;
}

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Pulse')
    .addItem('Set up relay', 'setupPulse')
    .addItem('Show admin key', 'showAdminKey')
    .addItem('Purge expired rows now', 'purgeExpired')
    .addItem('Relay health check', 'healthCheck')
    .addItem('Set auto-reply message…', 'promptAutoAck')
    .addItem('Set follow-up messages…', 'promptFollowUps')
    .addSeparator()
    .addItem('Deregister a device…', 'promptDeregister')
    .addToUi();
}

function showAdminKey() {
  var key = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  SpreadsheetApp.getUi().alert('Pulse admin key:\n\n' + (key || 'Not generated yet — run setupPulse'));
}

function healthCheck() {
  var mailbox = sheet_(SHEET_MAILBOX);
  var registry = sheet_(SHEET_REGISTRY);
  var rows = Math.max(mailbox.getLastRow() - 1, 0);
  var devices = Math.max(registry.getLastRow() - 1, 0);
  SpreadsheetApp.getUi().alert(
    'Pulse relay\n\nDevices registered: ' +
      devices +
      '\nRows in mailbox: ' +
      rows +
      '\nTTL: ' +
      PropertiesService.getScriptProperties().getProperty('TTL_MINUTES') +
      ' min\nTrigger installed: ' +
      (ScriptApp.getProjectTriggers().some(function (t) {
        return t.getHandlerFunction() === 'purgeExpired';
      })
        ? 'yes'
        : 'no — run Set up relay'),
  );
}

/**
 * The instant "our team is working on it" text. The app posts its own copy locally
 * so the asker sees it with zero latency; this value keeps every device in sync and
 * lets you change the wording without shipping a new build.
 */
function promptAutoAck() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();
  var current = props.getProperty('AUTO_ACK_TEXT') || DEFAULT_AUTO_ACK;
  var res = ui.prompt(
    'Automatic holding reply',
    'Shown the moment someone asks a question (max 240 chars):\n\nLeave blank to restore the default.',
    ui.ButtonSet.OK_CANCEL,
  );
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var next = String(res.getResponseText() || '').trim().slice(0, 240);
  props.setProperty('AUTO_ACK_TEXT', next || DEFAULT_AUTO_ACK);
  ui.alert('Auto-reply updated:\n\n' + (next || DEFAULT_AUTO_ACK));
}

/**
 * The two follow-ups: the gentle nudge and the final escalation. Same rule as the
 * auto-reply — the device generates them locally, this only keeps the wording in sync.
 */
function promptFollowUps() {
  var ui = SpreadsheetApp.getUi();
  var props = PropertiesService.getScriptProperties();

  var first = ui.prompt(
    'Follow-up message',
    'Sent once if no answer has arrived after a few minutes (max 240 chars).\nBlank restores the default.',
    ui.ButtonSet.OK_CANCEL,
  );
  if (first.getSelectedButton() !== ui.Button.OK) return;
  var nudge = String(first.getResponseText() || '').trim().slice(0, 240);
  props.setProperty('NUDGE_TEXT', nudge || DEFAULT_NUDGE);

  var second = ui.prompt(
    'Final escalation message',
    'Sent once, much later, if the question is still unanswered (max 240 chars).\nBlank restores the default.',
    ui.ButtonSet.OK_CANCEL,
  );
  if (second.getSelectedButton() !== ui.Button.OK) {
    ui.alert('Follow-up updated. The escalation was left unchanged.');
    return;
  }
  var escalate = String(second.getResponseText() || '').trim().slice(0, 240);
  props.setProperty('ESCALATE_TEXT', escalate || DEFAULT_ESCALATE);

  ui.alert(
    'Follow-ups updated.\n\nFirst:\n' +
      (nudge || DEFAULT_NUDGE) +
      '\n\nFinal:\n' +
      (escalate || DEFAULT_ESCALATE),
  );
}

function promptDeregister() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('Deregister device', 'Paste the deviceId to remove:', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var deviceId = res.getResponseText().trim();
  if (!deviceId) return;
  deleteDeviceRows_(deviceId);
  removeRegistryRow_(deviceId);
  ui.alert('Device removed. Its mailbox rows are gone.');
}

/* ---------------------------------------------------------------- actions */

function health_() {
  return {
    ok: true,
    service: 'pulse-relay',
    version: PropertiesService.getScriptProperties().getProperty('RELAY_VERSION') || '1.0.0',
    serverTime: Date.now(),
    ttlMinutes: ttlMinutes_(),
    autoAck: autoAckText_(),
    nudge: followUpText_('NUDGE_TEXT', DEFAULT_NUDGE),
    escalate: followUpText_('ESCALATE_TEXT', DEFAULT_ESCALATE),
  };
}

function register_(p) {
  var deviceId = String(p.deviceId || '');
  var alias = sanitiseAlias_(p.alias);

  if (!isUuid_(deviceId)) return fail('Invalid device id');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(15000)) return fail('Relay busy', 'Try again shortly.');

  try {
    var registry = sheet_(SHEET_REGISTRY);

    // Guard against a registration flood (per day, script-wide).
    var dayKey = todayKey_();
    var props = PropertiesService.getScriptProperties();
    var regKey = 'reg:' + dayKey;
    var regs = Number(props.getProperty(regKey) || '0');
    if (regs >= LIMITS.registrationsPerDay) {
      return fail('Registration limit reached', 'Try again tomorrow.');
    }

    var token = randomKey_(40);
    var row = [
      deviceId,
      sha256Hex_(token),
      alias,
      Date.now(),
      Date.now(),
      0,
      dayKey,
      'active',
      0,
      0, // lastAskAt — kept separate from lastSeen so polling never throttles sending
    ];

    var existing = findRegistryRow_(deviceId);
    if (existing > 0) {
      registry.getRange(existing, 1, 1, row.length).setValues([row]);
    } else {
      registry.appendRow(row);
    }
    props.setProperty(regKey, String(regs + 1));
    log_('register', 'device registered');

    return { ok: true, token: token, serverTime: Date.now() };
  } finally {
    lock.releaseLock();
  }
}

function ask_(p) {
  var auth = authenticate_(p);
  if (!auth.ok) return auth.response;

  var text = String(p.text || '').trim();
  if (!text) return fail('Empty question');
  if (text.length > LIMITS.questionChars) {
    return fail('Question too long', 'Keep it under ' + LIMITS.questionChars + ' characters.');
  }

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return fail('Relay busy', 'Try again shortly.');

  try {
    var reg = auth.row;
    var now = Date.now();

    // Measured against the last *question*, not the last request. Polling and
    // pings refresh lastSeen constantly and must never block a send.
    if (now - Number(reg.lastAskAt || 0) < LIMITS.minAskIntervalMs) {
      return fail('Slow down', 'Wait a moment between messages.');
    }
    if (Number(reg.asksToday || 0) >= LIMITS.askPerDay) {
      return fail('Daily limit reached', 'You can ask again tomorrow.');
    }

    var relayId = 'r_' + randomKey_(12);
    var ttlMs = ttlMinutes_() * 60 * 1000;

    sheet_(SHEET_MAILBOX).appendRow([
      relayId,
      auth.deviceId,
      String(p.threadId || '').slice(0, 64),
      String(p.localId || '').slice(0, 64),
      text,
      '',
      'new',
      now,
      '',
      now + ttlMs,
    ]);

    updateRegistryCounters_(auth.rowNumber, Number(reg.asksToday || 0) + 1, Number(reg.totalAsks || 0) + 1, now);
    log_('ask', 'queued');

    // Optional: hand the question to any AI worker you run (see README).
    notifyAiWorker_(relayId, text);

    return {
      ok: true,
      relayId: relayId,
      autoAck: autoAckText_(),
      nudge: followUpText_('NUDGE_TEXT', DEFAULT_NUDGE),
      escalate: followUpText_('ESCALATE_TEXT', DEFAULT_ESCALATE),
      serverTime: now,
    };
  } finally {
    lock.releaseLock();
  }
}

function poll_(p) {
  var auth = authenticate_(p);
  if (!auth.ok) return auth.response;

  var mailbox = sheet_(SHEET_MAILBOX);
  var lastRow = mailbox.getLastRow();
  if (lastRow < 2) return { ok: true, messages: [] };

  var values = mailbox.getRange(2, 1, lastRow - 1, HEADERS_MAILBOX.length).getValues();
  var out = [];
  var now = Date.now();

  for (var i = 0; i < values.length; i++) {
    var row = values[i];
    if (String(row[1]) !== auth.deviceId) continue;
    if (String(row[6]) !== 'answered') continue;
    if (Number(row[9]) && Number(row[9]) < now) continue; // expired, purger will collect it

    out.push({
      relayId: String(row[0]),
      messageId: String(row[3]),
      threadId: String(row[2]),
      answer: String(row[5]),
      answeredAt: Number(row[8]) || now,
    });
    if (out.length >= 20) break;
  }

  touchRegistry_(auth.rowNumber);
  return { ok: true, messages: out, serverTime: now };
}

function ack_(p) {
  var auth = authenticate_(p);
  if (!auth.ok) return auth.response;

  var ids = Array.isArray(p.relayIds) ? p.relayIds.map(String) : [];
  if (!ids.length) return { ok: true, deleted: 0 };

  var deleted = deleteMailboxRows_(auth.deviceId, ids);
  touchRegistry_(auth.rowNumber);
  log_('ack', 'burned ' + deleted + ' row(s)');
  return { ok: true, deleted: deleted, serverTime: Date.now() };
}

function ping_(p) {
  var auth = authenticate_(p);
  if (!auth.ok) return auth.response;

  touchRegistry_(auth.rowNumber);
  var mailbox = sheet_(SHEET_MAILBOX);
  var pending = 0;
  var lastRow = mailbox.getLastRow();
  if (lastRow >= 2) {
    var values = mailbox.getRange(2, 1, lastRow - 1, HEADERS_MAILBOX.length).getValues();
    for (var i = 0; i < values.length; i++) {
      if (String(values[i][1]) === auth.deviceId && String(values[i][6]) === 'answered') pending++;
    }
  }
  return {
    ok: true,
    serverTime: Date.now(),
    pending: pending,
    ttlMinutes: ttlMinutes_(),
  };
}

function deregister_(p) {
  var auth = authenticate_(p);
  if (!auth.ok) return auth.response;

  deleteMailboxRows_(auth.deviceId, null);
  removeRegistryRow_(auth.deviceId);
  log_('deregister', 'device removed');
  return { ok: true, serverTime: Date.now() };
}

/* ------------------------------------------------------------------ admin */

function adminInbox_(p) {
  if (!isAdmin_(p.adminKey)) return fail('Unauthorized');

  var mailbox = sheet_(SHEET_MAILBOX);
  var lastRow = mailbox.getLastRow();
  if (lastRow < 2) return { ok: true, questions: [] };

  var values = mailbox.getRange(2, 1, lastRow - 1, HEADERS_MAILBOX.length).getValues();
  var registryAliases = aliasMap_();
  var questions = [];

  for (var i = values.length - 1; i >= 0; i--) {
    var row = values[i];
    var status = String(row[6]);
    if (status === 'new' || status === 'answered') {
      questions.push({
        relayId: String(row[0]),
        deviceId: String(row[1]),
        alias: registryAliases[String(row[1])] || 'anonymous',
        question: String(row[4]),
        answer: String(row[5]) || undefined,
        status: status,
        createdAt: Number(row[7]) || 0,
        answeredAt: Number(row[8]) || 0,
      });
    }
    if (questions.length >= LIMITS.adminInboxMax) break;
  }
  return { ok: true, questions: questions, serverTime: Date.now() };
}

function adminReply_(p) {
  if (!isAdmin_(p.adminKey)) return fail('Unauthorized');

  var relayId = String(p.relayId || '');
  var answer = String(p.answer || '').trim();
  if (!relayId || !answer) return fail('Missing relayId or answer');
  if (answer.length > LIMITS.answerChars) return fail('Answer too long');

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return fail('Relay busy', 'Try again shortly.');

  try {
    var mailbox = sheet_(SHEET_MAILBOX);
    var lastRow = mailbox.getLastRow();
    if (lastRow < 2) return fail('No such question');

    var ids = mailbox.getRange(2, 1, lastRow - 1, 1).getValues();
    for (var i = 0; i < ids.length; i++) {
      if (String(ids[i][0]) !== relayId) continue;
      var rowNumber = i + 2;
      mailbox.getRange(rowNumber, 6).setValue(answer);
      mailbox.getRange(rowNumber, 7).setValue('answered');
      mailbox.getRange(rowNumber, 9).setValue(Date.now());
      log_('adminReply', 'answered');
      return { ok: true };
    }
    return fail('No such question', 'It may already have been delivered and burned.');
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ purge */

/** Installed by setupPulse() as a 5-minute time-driven trigger. */
function purgeExpired() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;

  try {
    var mailbox = sheet_(SHEET_MAILBOX);
    var lastRow = mailbox.getLastRow();
    if (lastRow < 2) return;

    var now = Date.now();
    var values = mailbox.getRange(2, 1, lastRow - 1, HEADERS_MAILBOX.length).getValues();
    var doomed = [];

    for (var i = 0; i < values.length; i++) {
      var expiresAt = Number(values[i][9]) || 0;
      var status = String(values[i][6]);
      var createdAt = Number(values[i][7]) || 0;
      var age = now - createdAt;

      // Expired by TTL, or answered and still sitting here far too long.
      var expired = expiresAt > 0 && expiresAt < now;
      var answeredStale = status === 'answered' && age > ttlMinutes_() * 60 * 1000;
      var forgotten = status === 'new' && age > 24 * 60 * 60 * 1000; // unanswerable, drop it

      if (expired || answeredStale || forgotten) doomed.push(i + 2);
    }

    // Bottom-up so indices stay valid.
    for (var d = doomed.length - 1; d >= 0; d--) {
      mailbox.deleteRow(doomed[d]);
    }

    if (doomed.length) log_('purge', 'removed ' + doomed.length + ' row(s)');
  } finally {
    lock.releaseLock();
  }
}

/* ----------------------------------------------------------------- helpers */

function parseBody_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  try {
    return JSON.parse(e.postData.contents);
  } catch (err) {
    return {};
  }
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON,
  );
}

function fail(error, hint) {
  return { ok: false, error: error, hint: hint || undefined, serverTime: Date.now() };
}

function sheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ensureSheet_(name, name === SHEET_MAILBOX ? HEADERS_MAILBOX : HEADERS_REGISTRY);
  return sheet;
}

function ensureSheet_(name, headers) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
  }
  var needsHeaders = sheet.getLastRow() === 0 || sheet.getLastColumn() < headers.length;
  if (needsHeaders) {
    // Also covers upgrading a sheet created by an earlier version.
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#0f1720').setFontColor('#eaf2f5');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Verifies deviceId + token against the hashed registry entry. */
function authenticate_(p) {
  var deviceId = String(p.deviceId || '');
  var token = String(p.token || '');
  if (!isUuid_(deviceId) || token.length < 16) {
    return { ok: false, response: fail('Missing credentials') };
  }

  var registry = sheet_(SHEET_REGISTRY);
  var lastRow = registry.getLastRow();
  if (lastRow < 2) return { ok: false, response: fail('Unknown device') };

  var values = registry.getRange(2, 1, lastRow - 1, HEADERS_REGISTRY.length).getValues();
  var candidate = sha256Hex_(token);

  for (var i = 0; i < values.length; i++) {
    if (String(values[i][0]) !== deviceId) continue;
    if (String(values[i][7]) !== 'active') return { ok: false, response: fail('Device revoked') };
    if (!constantTimeEqual_(String(values[i][1]), candidate)) {
      return { ok: false, response: fail('Invalid token') };
    }
    return {
      ok: true,
      deviceId: deviceId,
      rowNumber: i + 2,
      row: {
        lastSeen: Number(values[i][4]) || 0,
        asksToday: Number(values[i][5]) || 0,
        dayKey: String(values[i][6]),
        totalAsks: Number(values[i][8]) || 0,
        lastAskAt: Number(values[i][9]) || 0,
      },
    };
  }
  return { ok: false, response: fail('Unknown device') };
}

function updateRegistryCounters_(rowNumber, asksToday, totalAsks, now) {
  var registry = sheet_(SHEET_REGISTRY);
  var dayKey = todayKey_();
  var current = String(registry.getRange(rowNumber, 7).getValue());
  registry.getRange(rowNumber, 7).setValue(dayKey);
  registry.getRange(rowNumber, 6).setValue(current === dayKey ? asksToday : 1);
  registry.getRange(rowNumber, 9).setValue(totalAsks);
  registry.getRange(rowNumber, 10).setValue(now); // lastAskAt
  registry.getRange(rowNumber, 5).setValue(now);
}

function touchRegistry_(rowNumber) {
  var registry = sheet_(SHEET_REGISTRY);
  registry.getRange(rowNumber, 5).setValue(Date.now());
  var dayKey = todayKey_();
  if (String(registry.getRange(rowNumber, 7).getValue()) !== dayKey) {
    registry.getRange(rowNumber, 6).setValue(0);
  }
}

function findRegistryRow_(deviceId) {
  var registry = sheet_(SHEET_REGISTRY);
  var lastRow = registry.getLastRow();
  if (lastRow < 2) return 0;
  var ids = registry.getRange(2, 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === deviceId) return i + 2;
  }
  return 0;
}

function removeRegistryRow_(deviceId) {
  var row = findRegistryRow_(deviceId);
  if (row > 0) sheet_(SHEET_REGISTRY).deleteRow(row);
}

/** Deletes mailbox rows for a device. Passing ids limits it to a specific set. */
function deleteMailboxRows_(deviceId, ids) {
  var mailbox = sheet_(SHEET_MAILBOX);
  var lastRow = mailbox.getLastRow();
  if (lastRow < 2) return 0;

  var wanted = ids ? ids.reduce(function (acc, id) { acc[String(id)] = true; return acc; }, {}) : null;
  var values = mailbox.getRange(2, 1, lastRow - 1, 2).getValues();
  var doomed = [];

  for (var i = 0; i < values.length; i++) {
    if (String(values[i][1]) !== deviceId) continue;
    if (wanted && !wanted[String(values[i][0])]) continue;
    doomed.push(i + 2);
  }

  for (var d = doomed.length - 1; d >= 0; d--) {
    mailbox.deleteRow(doomed[d]);
  }
  return doomed.length;
}

function deleteDeviceRows_(deviceId) {
  deleteMailboxRows_(deviceId, null);
}

function aliasMap_() {
  var map = {};
  var registry = sheet_(SHEET_REGISTRY);
  var lastRow = registry.getLastRow();
  if (lastRow < 2) return map;
  var values = registry.getRange(2, 1, lastRow - 1, 3).getValues();
  for (var i = 0; i < values.length; i++) {
    map[String(values[i][0])] = String(values[i][2]);
  }
  return map;
}

function log_(event, detail) {
  try {
    sheet_(SHEET_LOG).appendRow([Date.now(), event, String(detail || '').slice(0, 200)]);
    var sheet = sheet_(SHEET_LOG);
    if (sheet.getLastRow() > 2000) sheet.deleteRows(2, sheet.getLastRow() - 1000);
  } catch (ignored) {
    // Logging must never break a request.
  }
}

/**
 * Optional AI bridge: set the script property AI_WEBHOOK_URL and every new
 * question is POSTed there (fire-and-forget). Your worker answers by calling
 * this same Web App with action=adminReply and the admin key.
 */
function notifyAiWorker_(relayId, question) {
  var url = PropertiesService.getScriptProperties().getProperty('AI_WEBHOOK_URL');
  if (!url) return;
  try {
    UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ relayId: relayId, question: question }),
      muteHttpExceptions: true,
    });
  } catch (ignored) {
    // A webhook failure must never block delivery.
  }
}

/* --------------------------------------------------------------- primitives */

function sha256Hex_(value) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    value,
    Utilities.Charset.UTF_8,
  );
  return bytes
    .map(function (b) {
      var v = (b < 0 ? b + 256 : b).toString(16);
      return v.length === 1 ? '0' + v : v;
    })
    .join('');
}

function constantTimeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function randomKey_(length) {
  var chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  var out = '';
  var bytes = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  // Mix in fresh entropy on every call; getUuid is CSPRNG-backed.
  while (out.length < length) {
    bytes = Utilities.getUuid().replace(/-/g, '') + bytes;
    for (var i = 0; i < bytes.length && out.length < length; i++) {
      out += chars.charAt(bytes.charCodeAt(i) % chars.length);
    }
  }
  return out;
}

/** Constant-time comparison of the supplied key against ADMIN_KEY. */
function isAdmin_(key) {
  var expected = PropertiesService.getScriptProperties().getProperty('ADMIN_KEY');
  if (!expected) return false;
  var supplied = String(key || '');
  if (!supplied || supplied.length !== expected.length) return false;
  return constantTimeEqual_(supplied, expected);
}

function isUuid_(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function sanitiseAlias_(value) {
  var alias = String(value || '')
    .replace(/[<>&"'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40);
  return alias || 'Anonymous';
}

function autoAckText_() {
  var text = PropertiesService.getScriptProperties().getProperty('AUTO_ACK_TEXT');
  return String(text || DEFAULT_AUTO_ACK).slice(0, 240) || DEFAULT_AUTO_ACK;
}

function followUpText_(property, fallback) {
  var text = PropertiesService.getScriptProperties().getProperty(property);
  return String(text || fallback).slice(0, 240) || fallback;
}

function ttlMinutes_() {
  var raw = Number(PropertiesService.getScriptProperties().getProperty('TTL_MINUTES'));
  return raw > 0 && raw <= 1440 ? raw : 15;
}

function todayKey_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'UTC', 'yyyy-MM-dd');
}
