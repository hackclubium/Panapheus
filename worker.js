const VERSION = 'panapheus-events-v1';
const TRIGGER_RESPONSES = [
  {
    name: 'pangram_meta',
    pattern: /\b(pan|panapheus|pangram|alphabet|every letter|all letters|quick brown fox)\b/i,
    text: 'The quick brown fox jumps over the lazy dog'
  },
  {
    name: 'thanks',
    pattern: /\b(thank\s*you|thanks|tanx|thx|ty|appreciate\s+(it|you)|much appreciated|cheers|props|kudos|bless)[\s,.:;!-]+p\w*\b/i,
    text: 'How vexingly quick daft zebras jump'
  },
  {
    name: 'praise',
    pattern: /\b(beautiful|nice pangram|good bot|well done|love this|you rock|great job|nailed it)\b/i,
    text: 'Pack my box with five dozen liquor jugs'
  },
  {
    name: 'surprise',
    pattern: /\b(wow|whoa|woah|omg|no way|wait (that'?s|thats) a pangram|how did you catch that)\b/i,
    text: 'Sphinx of black quartz, judge my vow'
  },
  {
    name: 'affection',
    pattern: /\b(ily|love you|luv u|you'?re the best|ur the best)\b/i,
    text: 'Waltz, bad nymph, for quick jigs vex'
  }
];
let pangramModule;
let dbReady;
const ENABLED_FLAVORS = [
  'pangrams enabled!',
  'alphabet watch engaged',
  'every-letter radar online',
  'quick brown fox mode active',
  'pangram powers: unlocked'
];
const DISABLED_FLAVORS = [
  'okay, no more pangrams for you',
  'got it, not an alphabet person',
  "i'll spare you from my alphabet wrath",
  'your loss, but i respect your choice',
  "fine, but i'll still be counting letters in my head",
  'understood, but my inner alphabet is crying',
  'okay, but my muse is giving you the side-eye'
];

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/__panapheus/version') {
      return new Response(VERSION, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }
    if (request.method === 'GET' && url.pathname === '/__panapheus/health') return health(env);
    if (request.method === 'GET' && url.pathname === '/__panapheus/debug') return debugState(env);
    if (request.method === 'GET' && url.pathname === '/__panapheus/slack-debug') return slackDebug(env);
    if (request.method === 'GET' && url.pathname === '/__panapheus/analyze') return analyzeRequest(url);
    if (request.method === 'GET' && url.pathname === '/__panapheus/last') return lastDiagnostic(request, env);
    if (request.method === 'GET' && url.pathname === '/state') return stateSnapshot(request, env);
    if (request.method !== 'POST') return new Response('not found', { status: 404 });

    const rawBody = await request.text();
    waitUntil(ctx, recordDiagnostic(env, {
      type: 'post_seen',
      at: new Date().toISOString(),
      path: url.pathname,
      contentType: request.headers.get('content-type') ?? '',
      bodyStart: rawBody.slice(0, 80)
    }));

    const verification = urlVerification(rawBody);
    if (verification) {
      return new Response(verification, { headers: { 'content-type': 'text/plain; charset=utf-8' } });
    }

    const contentType = request.headers.get('content-type') ?? '';
    if (!(await validSlackRequest(request, rawBody, env.SLACK_SIGNING_SECRET))) {
      waitUntil(ctx, recordDiagnostic(env, { type: 'invalid_signature', at: new Date().toISOString() }));
      return slackResponse('Panapheus received this command, but Slack signature verification failed. Check Worker SLACK_SIGNING_SECRET.');
    }

    if (contentType.includes('application/json')) {
      try {
        return await slackEvent(rawBody, env);
      } catch (error) {
        await recordDiagnostic(env, { type: 'event_error', error: error.message, at: new Date().toISOString() });
        return new Response('ok');
      }
    }

    return slashCommand(rawBody, env, ctx);
  }
};

function waitUntil(ctx, promise) {
  if (ctx?.waitUntil) ctx.waitUntil(promise);
  else promise.catch(() => {});
}

async function health(env) {
  const checks = {
    version: VERSION,
    hasSlackSigningSecret: Boolean(env.SLACK_SIGNING_SECRET),
    hasSlackBotToken: Boolean(env.SLACK_BOT_TOKEN),
    hasStateToken: Boolean(env.PANAPHEUS_STATE_TOKEN),
    hasD1Binding: Boolean(env.PANAPHEUS_DB),
    d1Readable: false
  };

  try {
    await getState(env);
    checks.d1Readable = true;
  } catch (error) {
    checks.d1Error = error.message;
  }

  return Response.json(checks);
}

async function debugState(env) {
  const state = await getState(env);
  const diagnostic = (await dbGet(env, 'lastDiagnostic', 'json')) ?? null;
  const messageDiagnostic = (await dbGet(env, 'lastMessageDiagnostic', 'json')) ?? null;
  const slashDiagnostic = (await dbGet(env, 'lastSlashDiagnostic', 'json')) ?? null;
  const recentMessages = (await dbGet(env, 'recentMessageDiagnostics', 'json')) ?? [];
  return Response.json({ version: VERSION, state, diagnostic, messageDiagnostic, slashDiagnostic, recentMessages });
}

async function slackDebug(env) {
  const state = await getState(env);
  const channels = [];

  for (const channel of state.channels) {
    const info = await slack(env, 'conversations.info', { channel }).catch((error) => ({ error: error.message }));
    channels.push({
      id: channel,
      ok: Boolean(info.channel),
      name: info.channel?.name,
      isChannel: info.channel?.is_channel,
      isGroup: info.channel?.is_group,
      isMember: info.channel?.is_member,
      error: info.error
    });
  }

  return Response.json({ version: VERSION, channels });
}

function analyzeRequest(url) {
  return loadPangram().then(({ analyzePangram }) => Response.json(analyzePangram(url.searchParams.get('text') ?? '')));
}

async function slashCommand(rawBody, env, ctx) {
  const form = new URLSearchParams(rawBody);
  const command = form.get('command');
  if (!['/pan-in', '/pan-out', '/pan-chan-in', '/pan-chan-out', '/pan-test', '/pan-debug'].includes(command)) {
    return slackResponse('Unknown command.');
  }

  if (command === '/pan-test') {
    const { analyzePangram } = await loadPangram();
    return slackResponse(`\`\`\`json\n${JSON.stringify(analyzePangram(form.get('text') ?? ''), null, 2)}\n\`\`\``);
  }
  if (command === '/pan-debug') return slackResponse(`\`\`\`json\n${JSON.stringify(await slashDebug(env, form), null, 2)}\n\`\`\``);

  const payload = { command, channel: form.get('channel_id'), user: form.get('user_id') };
  try {
    await updateState(env, payload.command, payload.channel, payload.user);
    await recordSlashDiagnostic(env, { ...payload, type: 'slash_ok', at: new Date().toISOString() });
    if (payload.command === '/pan-chan-in') waitUntil(ctx, joinChannelInBackground(env, payload));
  } catch (error) {
    await recordSlashDiagnostic(env, { ...payload, type: 'slash_error', error: error.message, at: new Date().toISOString() });
    return slackResponse(`Panapheus config error: ${error.message}`);
  }

  const joinNote = command === '/pan-chan-in' ? ' Public channels auto-join in background; private channels still need `/invite @Panapheus`.' : '';
  return slackResponse(`${messageFor(command)}${joinNote} (${VERSION}; saving in background; you=${payload.user}; channel=${payload.channel})`);
}

async function slashDebug(env, form) {
  const state = await getState(env);
  return {
    version: VERSION,
    slashUser: form.get('user_id'),
    slashChannel: form.get('channel_id'),
    userOptedIn: state.users.includes(form.get('user_id')),
    channelOptedIn: state.channels.includes(form.get('channel_id')),
    state,
    lastMessage: (await dbGet(env, 'lastMessageDiagnostic', 'json')) ?? null,
    recentMessages: (await dbGet(env, 'recentMessageDiagnostics', 'json')) ?? []
  };
}

async function joinChannelInBackground(env, payload) {
  try {
    const joinNote = await joinChannel(env, payload.channel);
    await recordDiagnostic(env, { ...payload, type: 'join_ok', joinNote, at: new Date().toISOString() });
  } catch (error) {
    await recordDiagnostic(env, { ...payload, type: 'join_error', error: error.message, at: new Date().toISOString() });
  }
}

async function lastDiagnostic(request, env) {
  if (request.headers.get('authorization') !== `Bearer ${env.PANAPHEUS_STATE_TOKEN}`) {
    return new Response('unauthorized', { status: 401 });
  }
  return Response.json((await dbGet(env, 'lastDiagnostic', 'json')) ?? null);
}

async function recordDiagnostic(env, value) {
  await dbPut(env, 'lastDiagnostic', JSON.stringify(value)).catch(() => {});
}

async function recordMessageDiagnostic(env, value) {
  try {
    await dbPut(env, 'lastMessageDiagnostic', JSON.stringify(value));
    const recent = (await dbGet(env, 'recentMessageDiagnostics', 'json')) ?? [];
    recent.unshift(value);
    await dbPut(env, 'recentMessageDiagnostics', JSON.stringify(recent.slice(0, 20)));
  } catch {}
  await recordDiagnostic(env, value);
}

async function recordSlashDiagnostic(env, value) {
  await dbPut(env, 'lastSlashDiagnostic', JSON.stringify(value)).catch(() => {});
  await recordDiagnostic(env, value);
}

function urlVerification(rawBody) {
  try {
    const payload = JSON.parse(rawBody);
    return payload?.type === 'url_verification' ? payload.challenge : '';
  } catch {
    return '';
  }
}

async function slackEvent(rawBody, env) {
  const payload = JSON.parse(rawBody);
  if (payload.type === 'url_verification') return Response.json({ challenge: payload.challenge });

  const event = payload.event;
  await recordDiagnostic(env, {
    type: 'event_seen',
    payloadType: payload.type,
    eventType: event?.type,
    channel: event?.channel,
    user: event?.user,
    text: event?.text ?? '',
    at: new Date().toISOString()
  });
  if (payload.type !== 'event_callback' || event?.type !== 'message') return new Response('ok');
  if (!event.user || event.subtype || event.bot_id || !event.channel || !event.ts) {
    await recordDiagnostic(env, { type: 'message_skip', reason: 'not_user_message', at: new Date().toISOString() });
    return new Response('ok');
  }

  if (await handleThankYou(env, event)) return new Response('ok');

  const state = await getState(env);
  if (!state.channels.includes(event.channel) || !state.users.includes(event.user)) {
    await recordMessageDiagnostic(env, {
      type: 'message_skip',
      reason: 'not_opted_in',
      channel: event.channel,
      user: event.user,
      state,
      at: new Date().toISOString()
    });
    return new Response('ok');
  }
  if ((event.text ?? '').length > 300) {
    await recordMessageDiagnostic(env, { type: 'message_skip', reason: 'too_long', channel: event.channel, user: event.user, at: new Date().toISOString() });
    return new Response('ok');
  }

  const result = await processPangramMessage(env, {
    channel: event.channel,
    user: event.user,
    ts: event.ts,
    text: event.text ?? '',
    thread_ts: event.thread_ts,
    reactions: []
  });
  if (!result.ok) {
    await recordMessageDiagnostic(env, {
      type: 'message_skip',
      reason: result.reason,
      channel: event.channel,
      user: event.user,
      text: event.text ?? '',
      missing: result.analysis?.missing ?? [],
      letters: result.analysis?.letters ?? [],
      at: new Date().toISOString()
    });
    return new Response('ok');
  }
  await recordMessageDiagnostic(env, {
    type: 'pangram_posted',
    channel: event.channel,
    user: event.user,
    source: 'event',
    letters: result.analysis.letters,
    at: new Date().toISOString()
  });

  return new Response('ok');
}

async function processPangramMessage(env, message) {
  const { analyzePangram } = await loadPangram();
  const processedKey = `processed:${message.channel}:${message.ts}`;
  if (await dbGet(env, processedKey)) return { ok: false, reason: 'already_seen' };
  if ((message.reactions ?? []).some((reaction) => reaction.name === 'abc')) return { ok: false, reason: 'already_seen' };

  const analysis = analyzePangram(message.text);
  if (!analysis.ok) return { ok: false, reason: 'not_pangram', analysis };

  const pangram = displayText(message.text);
  await Promise.all([
    slack(env, 'chat.postMessage', {
      channel: message.channel,
      thread_ts: message.ts,
      text: `${pangram}\n---\nuses every letter\n– a pangram by <@${message.user}>, ${new Date().getUTCFullYear()}`,
      blocks: [
        { type: 'section', text: { type: 'plain_text', text: pangram } },
        { type: 'divider' },
        { type: 'context', elements: [{ type: 'mrkdwn', text: `uses every letter\n– a pangram by <@${message.user}>, ${new Date().getUTCFullYear()}` }] }
      ],
      unfurl_links: false,
      unfurl_media: false
    }),
    slack(env, 'reactions.add', { channel: message.channel, timestamp: message.ts, name: 'abc' })
  ]);
  await markPangram(env, message.thread_ts || message.ts).catch(() => {});
  await dbPut(env, processedKey, '1', 12 * 60 * 60).catch(() => {});
  await sendOptOutHint(env, message.channel, message.user, message.thread_ts || message.ts).catch((error) => (
    recordDiagnostic(env, { type: 'hint_error', error: error.message, at: new Date().toISOString() })
  ));
  return { ok: true, analysis };
}

function loadPangram() {
  pangramModule ||= import('./scripts/pangram.mjs');
  return pangramModule;
}

async function handleThankYou(env, event) {
  const trigger = thankYouTrigger(event.text ?? '');
  if (!event.thread_ts || !trigger) return false;
  if (!(await wasPangram(env, event.thread_ts))) return false;

  // reactions.add failing (e.g. already_reacted on a Slack retry) shouldn't block the reply
  await slack(env, 'reactions.add', { channel: event.channel, timestamp: event.ts, name: 'heart' }).catch(() => {});
  const { analyzePangram } = await loadPangram();
  const analysis = analyzePangram(trigger.text);
  await slack(env, 'chat.postMessage', {
    channel: event.channel,
    thread_ts: event.thread_ts,
    text: `${trigger.text}\n---\nuses every letter\nby <@${event.user}>`,
    blocks: [
      { type: 'section', text: { type: 'plain_text', text: displayText(trigger.text) } },
      { type: 'divider' },
      { type: 'context', elements: [{ type: 'mrkdwn', text: `uses every letter\nby <@${event.user}>` }] }
    ]
  });
  await dbDelete(env, `pangram:${event.thread_ts}`).catch(() => {});
  await recordMessageDiagnostic(env, { type: 'thank_you', trigger: trigger.name, channel: event.channel, user: event.user, at: new Date().toISOString() });
  return true;
}

function thankYouTrigger(text) {
  return TRIGGER_RESPONSES.find((trigger) => trigger.pattern.test(text));
}

function displayText(text) {
  return text
    .replace(/<[a-z][a-z0-9+.-]*:\/\/[^>]*>/gi, ' ')
    .replace(/<[^>\s|]+\|[^>]*>/g, ' ')
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' ')
    .replace(/\bwww\.\S+/gi, ' ')
    .replace(/<[@#!][A-Z0-9][^>]*>/g, ' ')
    .replace(/<![^>]+>/g, ' ')
    .replace(/\b(?=[A-Z0-9]{8,}\b)(?=[A-Z0-9]*\d)[A-Z0-9]+\b/gi, ' ')
    .replace(/(^|\n)>\s?/g, '$1')
    .replace(/[*_~]/g, '')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

async function markPangram(env, threadTs) {
  await dbPut(env, `pangram:${threadTs}`, '1', 12 * 60 * 60);
}

async function wasPangram(env, threadTs) {
  return Boolean(await dbGet(env, `pangram:${threadTs}`));
}

async function sendOptOutHint(env, channel, user, threadTs) {
  const key = `pangram_hinted:${user}`;
  if (await dbGet(env, key)) return;

  await slack(env, 'chat.postEphemeral', {
    channel,
    user,
    thread_ts: threadTs,
    text: "you don't want me to\nnotice pangrams?\n`/pan-out`"
  });
  await dbPut(env, key, '1');
}

async function stateSnapshot(request, env) {
  if (request.headers.get('authorization') !== `Bearer ${env.PANAPHEUS_STATE_TOKEN}`) {
    return new Response('unauthorized', { status: 401 });
  }
  return Response.json(await getState(env));
}

function slackResponse(text) {
  return Response.json({ response_type: 'ephemeral', text });
}

function messageFor(command) {
  return {
    '/pan-in': `${sample(ENABLED_FLAVORS)} – you can disable it with \`/pan-out\``,
    '/pan-out': `${sample(DISABLED_FLAVORS)} – you can reënable it with \`/pan-in\``,
    '/pan-chan-in': 'Pangram tracking on for this channel.',
    '/pan-chan-out': 'Pangram tracking off for this channel.'
  }[command];
}

function sample(items) {
  return items[Math.floor(Math.random() * items.length)];
}

async function updateState(env, command, channel, user) {
  const state = await getState(env);
  switch (command) {
    case '/pan-in':
      add(state.users, user);
      break;
    case '/pan-out':
      remove(state.users, user);
      break;
    case '/pan-chan-in':
      add(state.channels, channel);
      break;
    case '/pan-chan-out':
      remove(state.channels, channel);
      break;
  }
  state.channels.sort();
  state.users.sort();
  await dbPut(env, 'state', JSON.stringify(state));
}

async function getState(env) {
  return (await dbGet(env, 'state', 'json')) ?? { channels: [], users: [] };
}

async function slack(env, method, body) {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.SLACK_BOT_TOKEN}`,
      'content-type': 'application/json; charset=utf-8'
    },
    body: JSON.stringify(body)
  });
  const json = await response.json();
  if (!json.ok) throw new Error(`${method}: ${json.error}`);
  return json;
}

async function joinChannel(env, channel) {
  try {
    await slack(env, 'conversations.join', { channel });
    return '';
  } catch (error) {
    if (error.message.includes('method_not_supported_for_channel_type')) return ' Private channel: invite me manually with `/invite @Panapheus`.';
    if (error.message.includes('is_archived')) throw error;
    if (error.message.includes('channel_not_found')) throw error;
    throw error;
  }
}

function add(list, value) {
  if (value && !list.includes(value)) list.push(value);
}

function remove(list, value) {
  const index = list.indexOf(value);
  if (index !== -1) list.splice(index, 1);
}

async function dbGet(env, key, type = 'text') {
  await ensureDb(env);
  const now = Math.floor(Date.now() / 1000);
  const row = await env.PANAPHEUS_DB
    .prepare('SELECT value, expires_at FROM panapheus_state WHERE key = ?')
    .bind(key)
    .first();
  if (!row) return null;
  if (row.expires_at && row.expires_at <= now) {
    await dbDelete(env, key);
    return null;
  }
  return type === 'json' ? JSON.parse(row.value) : row.value;
}

async function dbPut(env, key, value, expirationTtl = null) {
  await ensureDb(env);
  const expiresAt = expirationTtl ? Math.floor(Date.now() / 1000) + expirationTtl : null;
  await env.PANAPHEUS_DB
    .prepare('INSERT INTO panapheus_state (key, value, expires_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, expires_at = excluded.expires_at')
    .bind(key, value, expiresAt)
    .run();
}

async function dbDelete(env, key) {
  await ensureDb(env);
  await env.PANAPHEUS_DB
    .prepare('DELETE FROM panapheus_state WHERE key = ?')
    .bind(key)
    .run();
}

async function ensureDb(env) {
  if (!env.PANAPHEUS_DB) throw new Error('PANAPHEUS_DB D1 binding is required');
  dbReady ||= env.PANAPHEUS_DB
    .prepare('CREATE TABLE IF NOT EXISTS panapheus_state (key TEXT PRIMARY KEY, value TEXT NOT NULL, expires_at INTEGER)')
    .run()
    .then(async () => {
      await env.PANAPHEUS_DB
        .prepare('DELETE FROM panapheus_state WHERE expires_at IS NOT NULL AND expires_at <= ?')
        .bind(Math.floor(Date.now() / 1000))
        .run();
    });
  await dbReady;
}

async function validSlackRequest(request, rawBody, secret) {
  const timestamp = request.headers.get('x-slack-request-timestamp');
  const signature = request.headers.get('x-slack-signature');
  if (!timestamp || !signature || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;

  const key = await crypto.subtle.importKey('raw', encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, encode(`v0:${timestamp}:${rawBody}`));
  return timingSafeEqual(signature, `v0=${hex(digest)}`);
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

function encode(value) {
  return new TextEncoder().encode(value);
}

function hex(buffer) {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
