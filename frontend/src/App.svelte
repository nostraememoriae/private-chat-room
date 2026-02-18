<script lang="ts">
  import { onMount, onDestroy } from 'svelte';

  // ── State (Svelte 5 runes) ──────────────────────────────────────────────
  let screen      = $state<'login' | 'chat'>('login');

  // Login
  let totpValue   = $state('');
  let loginError  = $state('');
  let loggingIn   = $state(false);

  // Chat
  let myUsername  = $state('');
  let messages    = $state<Message[]>([]);
  let messageText = $state('');
  let ws: WebSocket | null = null;
  let messagesEl = $state<HTMLDivElement>();

  interface Message {
    id?: string;
    user?: string;
    text: string;
    timestamp?: number;
    sys?: boolean;
  }

  // ── Lifecycle ───────────────────────────────────────────────────────────
  onMount(async () => {
    try {
      const res = await fetch('/me');
      if (res.ok) {
        const data = await res.json();
        myUsername = data.username;
        connect();
      }
    } catch {}
  });

  onDestroy(() => ws?.close());

  // ── Auth ────────────────────────────────────────────────────────────────
  async function login() {
    if (!totpValue || loggingIn) return;
    loggingIn  = true;
    loginError = '';

    try {
      const res = await fetch('/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: totpValue }),
      });
      if (res.ok) {
        const data = await res.json();
        myUsername = data.username;
        connect();
      } else {
        const err = await res.json().catch(() => ({}));
        loginError = (err as any).error ?? 'Invalid code';
      }
    } catch {
      loginError = 'Connection error';
    } finally {
      loggingIn = false;
    }
  }

  function connect() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    ws = new WebSocket(`${proto}//${location.host}/ws`);

    ws.onopen = () => {
      screen = 'chat';
      setTimeout(scrollBottom, 50);
    };

    ws.onmessage = ({ data }) => {
      try {
        const p = JSON.parse(data);
        if (p.type === 'history') {
          messages = p.messages.map((m: any) => ({ ...m, id: m.id ?? crypto.randomUUID() }));
          setTimeout(scrollBottom, 50);
        } else if (p.type === 'message') {
          const msg = { ...p, id: p.id ?? crypto.randomUUID() };
          messages = [...messages, msg];
          setTimeout(scrollBottom, 30);
        } else if (p.type === 'system') {
          messages = [...messages, { id: crypto.randomUUID(), text: p.text, sys: true }];
          setTimeout(scrollBottom, 30);
        } else if (p.type === 'error') {
          alert(p.error);
        }
      } catch {}
    };

    ws.onclose = () => {
      screen     = 'login';
      loginError = 'Disconnected from server.';
    };
  }

  function sendMessage() {
    const text = messageText.trim();
    if (!text || !ws) return;
    ws.send(JSON.stringify({ text }));
    messageText = '';
  }

  async function logout() {
    await fetch('/logout', { method: 'POST' });
    ws?.close();
    screen = 'login';
  }

  function scrollBottom() {
    messagesEl?.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
  }

  function fmt(ts?: number) {
    if (!ts) return '';
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function safe(text: string) {
    return text.replace(/[&<>"']/g, m =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' }[m]!));
  }

  // Strip non-digits, cap at 6
  function onTotpInput(e: Event) {
    const v = (e.target as HTMLInputElement).value.replace(/\D/g, '').slice(0, 6);
    totpValue = v;
    (e.target as HTMLInputElement).value = v;
  }
</script>

<!--------------------------------------------------------------------------->
<!-- LOGIN                                                                   -->
<!--------------------------------------------------------------------------->
{#if screen === 'login'}
<div class="login-bg">
  <div class="blob b1"></div>
  <div class="blob b2"></div>
  <div class="blob b3"></div>

  <div class="card">
    <span class="lock">🔐</span>
    <h1>Locked Room</h1>
    <p class="sub">Enter your TOTP code to enter.</p>

    <input
      class="totp"
      type="text"
      inputmode="numeric"
      autocomplete="one-time-code"
      maxlength="6"
      placeholder="000000"
      value={totpValue}
      oninput={onTotpInput}
      onkeydown={(e) => e.key === 'Enter' && login()}
    />

    {#if loginError}
      <p class="err">{loginError}</p>
    {/if}

    <button
      class="unlock-btn"
      onclick={login}
      disabled={loggingIn || totpValue.length !== 6}
    >
      {#if loggingIn}<span class="spin"></span> Verifying…{:else}Unlock →{/if}
    </button>
  </div>
</div>

<!--------------------------------------------------------------------------->
<!-- CHAT                                                                    -->
<!--------------------------------------------------------------------------->
{:else}
<div class="chat-root">

  <header>
    <div class="hl">
      <span class="live-dot"></span>
      <span class="room-name">Private Room</span>
    </div>
    <div class="hr">
      <span class="you-tag">you: {myUsername}</span>
      <button class="exit" onclick={logout}>Exit ✕</button>
    </div>
  </header>

  <div class="msgs" bind:this={messagesEl}>
    {#if messages.length === 0}
      <p class="empty">No messages yet. Say hi! 👋</p>
    {/if}

    {#each messages as msg (msg.id)}
      {#if msg.sys}
        <div class="sys">{msg.text}</div>
      {:else}
        {@const me = msg.user === myUsername}
        <div class="row {me ? 'row-me' : 'row-them'}">
          {#if !me}<div class="av">{(msg.user ?? '?')[0].toUpperCase()}</div>{/if}
          <div class="bubble {me ? 'bme' : 'bthem'}">
            {#if !me}<span class="buser">{msg.user}</span>{/if}
            <span class="btext">{@html safe(msg.text ?? '')}</span>
            <span class="btime">{fmt(msg.timestamp)}</span>
          </div>
          {#if me}<div class="av av-me">{myUsername[0].toUpperCase()}</div>{/if}
        </div>
      {/if}
    {/each}
  </div>

  <div class="bar">
    <input
      class="msginput"
      type="text"
      placeholder="Type something…"
      bind:value={messageText}
      onkeydown={(e) => e.key === 'Enter' && sendMessage()}
    />
    <button aria-label="send-message" class="sendbtn" onclick={sendMessage} disabled={!messageText.trim()}>
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2.5"
           stroke-linecap="round" stroke-linejoin="round">
        <line x1="22" y1="2" x2="11" y2="13"/>
        <polygon points="22 2 15 22 11 13 2 9 22 2"/>
      </svg>
    </button>
  </div>

</div>
{/if}

<style>
  @import url('https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=IBM+Plex+Mono:wght@400;600&display=swap');

  :global(*, *::before, *::after) { box-sizing: border-box; margin: 0; padding: 0; }

  :global(body) {
    font-family: 'Syne', sans-serif;
    background: #fff0f6;
    height: 100vh;
    overflow: hidden;
  }

  /* ──────────────────────────── LOGIN ──────────────────────────────────── */
  .login-bg {
    position: relative;
    width: 100vw;
    height: 100vh;
    background: linear-gradient(140deg, #fff0f6 0%, #ffd6eb 55%, #ffbfdf 100%);
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }

  .blob {
    position: absolute;
    border-radius: 50%;
    filter: blur(70px);
    opacity: .4;
    animation: drift 9s ease-in-out infinite alternate;
  }
  .b1 { width: 480px; height: 480px; background: radial-gradient(#ff2d78, #ff80b5); top: -150px; left: -130px; }
  .b2 { width: 340px; height: 340px; background: radial-gradient(#ff5599, #ffb3d4); bottom: -90px; right: -70px; animation-delay: -4s; }
  .b3 { width: 220px; height: 220px; background: radial-gradient(#ffb3d4, #ffd6eb); top: 38%; left: 58%; animation-delay: -7s; }

  @keyframes drift {
    from { transform: translate(0,0) scale(1); }
    to   { transform: translate(28px,-18px) scale(1.1); }
  }

  .card {
    position: relative;
    z-index: 10;
    background: rgba(255,255,255,.72);
    backdrop-filter: blur(28px) saturate(180%);
    -webkit-backdrop-filter: blur(28px) saturate(180%);
    border: 1.5px solid rgba(255,45,120,.18);
    border-radius: 28px;
    padding: 3rem 2.5rem 2.5rem;
    width: 100%;
    max-width: 370px;
    text-align: center;
    box-shadow:
      0 10px 50px rgba(255,45,120,.18),
      0 2px 8px rgba(255,45,120,.08),
      inset 0 1px 0 rgba(255,255,255,.95);
  }

  .lock {
    font-size: 2.6rem;
    display: block;
    margin-bottom: .7rem;
    animation: bob 2.2s ease-in-out infinite;
  }
  @keyframes bob {
    0%,100% { transform: translateY(0); }
    50%      { transform: translateY(-5px); }
  }

  h1 {
    font-size: 2rem;
    font-weight: 800;
    color: #ff2d78;
    letter-spacing: -.03em;
    margin-bottom: .35rem;
  }

  .sub {
    color: #b06080;
    font-size: .85rem;
    font-family: 'IBM Plex Mono', monospace;
    margin-bottom: 1.8rem;
  }

  .totp {
    width: 100%;
    background: rgba(255,45,120,.05);
    border: 2px solid rgba(255,45,120,.22);
    border-radius: 14px;
    padding: .95rem 1rem;
    font-family: 'IBM Plex Mono', monospace;
    font-size: 1.8rem;
    font-weight: 600;
    color: #1a0010;
    text-align: center;
    letter-spacing: .4em;
    outline: none;
    transition: border-color .2s, box-shadow .2s;
  }
  .totp::placeholder { color: #ffb3d0; letter-spacing: .2em; }
  .totp:focus {
    border-color: #ff2d78;
    box-shadow: 0 0 0 4px rgba(255,45,120,.13);
    background: #fff;
  }

  .err {
    color: #c0005c;
    font-size: .78rem;
    font-family: 'IBM Plex Mono', monospace;
    margin-top: .55rem;
    animation: shake .3s ease;
  }
  @keyframes shake {
    0%,100% { transform: translateX(0); }
    25%      { transform: translateX(-6px); }
    75%      { transform: translateX(6px); }
  }

  .unlock-btn {
    margin-top: 1.1rem;
    width: 100%;
    padding: .95rem;
    background: linear-gradient(135deg, #ff2d78 0%, #ff6baa 100%);
    color: #fff;
    border: none;
    border-radius: 14px;
    font-family: 'Syne', sans-serif;
    font-size: 1rem;
    font-weight: 700;
    letter-spacing: .04em;
    cursor: pointer;
    transition: transform .15s, box-shadow .15s, opacity .2s;
    box-shadow: 0 4px 22px rgba(255,45,120,.38);
    display: flex;
    align-items: center;
    justify-content: center;
    gap: .5rem;
  }
  .unlock-btn:hover:not(:disabled) {
    transform: translateY(-2px);
    box-shadow: 0 8px 30px rgba(255,45,120,.48);
  }
  .unlock-btn:active:not(:disabled) { transform: translateY(0); }
  .unlock-btn:disabled { opacity: .45; cursor: not-allowed; box-shadow: none; }

  .spin {
    display: inline-block;
    width: 15px; height: 15px;
    border: 2.5px solid rgba(255,255,255,.35);
    border-top-color: #fff;
    border-radius: 50%;
    animation: rot .7s linear infinite;
  }
  @keyframes rot { to { transform: rotate(360deg); } }

  /* ──────────────────────────── CHAT ───────────────────────────────────── */
  .chat-root {
    display: flex;
    flex-direction: column;
    height: 100vh;
    background: #fff0f6;
  }

  header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: .85rem 1.4rem;
    background: #ff2d78;
    box-shadow: 0 2px 18px rgba(255,45,120,.35);
    flex-shrink: 0;
  }

  .hl { display: flex; align-items: center; gap: .6rem; }

  .live-dot {
    width: 10px; height: 10px;
    border-radius: 50%;
    background: #fff;
    box-shadow: 0 0 0 3px rgba(255,255,255,.28);
    animation: hb 1.6s ease-in-out infinite;
  }
  @keyframes hb {
    0%,100% { transform: scale(1); box-shadow: 0 0 0 3px rgba(255,255,255,.28); }
    50%      { transform: scale(1.25); box-shadow: 0 0 0 5px rgba(255,255,255,.12); }
  }

  .room-name {
    color: #fff;
    font-weight: 700;
    font-size: .92rem;
    letter-spacing: .06em;
    text-transform: uppercase;
  }

  .hr { display: flex; align-items: center; gap: .7rem; }

  .you-tag {
    font-family: 'IBM Plex Mono', monospace;
    font-size: .72rem;
    color: rgba(255,255,255,.82);
    background: rgba(255,255,255,.18);
    padding: .22rem .65rem;
    border-radius: 20px;
  }

  .exit {
    background: rgba(255,255,255,.22);
    color: #fff;
    border: none;
    border-radius: 8px;
    padding: .35rem .85rem;
    font-family: 'Syne', sans-serif;
    font-size: .78rem;
    font-weight: 600;
    cursor: pointer;
    transition: background .15s;
  }
  .exit:hover { background: rgba(255,255,255,.35); }

  /* Messages */
  .msgs {
    flex: 1;
    overflow-y: auto;
    padding: 1.25rem 1rem;
    display: flex;
    flex-direction: column;
    gap: .65rem;
    scroll-behavior: smooth;
  }
  .msgs::-webkit-scrollbar { width: 4px; }
  .msgs::-webkit-scrollbar-track { background: transparent; }
  .msgs::-webkit-scrollbar-thumb { background: rgba(255,45,120,.28); border-radius: 10px; }

  .empty {
    margin: auto;
    color: #b06080;
    font-size: .88rem;
    font-family: 'IBM Plex Mono', monospace;
    opacity: .7;
  }

  .sys {
    align-self: center;
    font-family: 'IBM Plex Mono', monospace;
    font-size: .7rem;
    color: #b06080;
    background: rgba(255,45,120,.07);
    border: 1px solid rgba(255,45,120,.13);
    padding: .28rem .8rem;
    border-radius: 20px;
  }

  .row {
    display: flex;
    align-items: flex-end;
    gap: .45rem;
    animation: up .22s ease;
  }
  @keyframes up {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .row-me   { align-self: flex-end; }
  .row-them { align-self: flex-start; }

  .av {
    width: 30px; height: 30px;
    flex-shrink: 0;
    border-radius: 50%;
    background: linear-gradient(135deg, #ff6baa, #c0005c);
    color: #fff;
    font-size: .75rem;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 2px 8px rgba(255,45,120,.28);
  }
  .av-me { background: linear-gradient(135deg, #1a0010, #3d0020); }

  .bubble {
    max-width: min(70%, 400px);
    padding: .55rem .85rem;
    border-radius: 18px;
    line-height: 1.46;
    word-break: break-word;
  }

  .bme {
    background: linear-gradient(135deg, #ff2d78 0%, #ff5599 100%);
    color: #fff;
    border-bottom-right-radius: 4px;
    box-shadow: 0 3px 16px rgba(255,45,120,.32);
  }

  .bthem {
    background: #fff;
    color: #1a0010;
    border: 1.5px solid rgba(255,45,120,.16);
    border-bottom-left-radius: 4px;
    box-shadow: 0 2px 8px rgba(255,45,120,.07);
  }

  .buser {
    display: block;
    font-size: .67rem;
    font-weight: 700;
    color: #ff2d78;
    letter-spacing: .04em;
    text-transform: uppercase;
    margin-bottom: .18rem;
  }

  .btext { display: block; font-size: .9rem; }

  .btime {
    display: block;
    font-family: 'IBM Plex Mono', monospace;
    font-size: .6rem;
    margin-top: .28rem;
    opacity: .58;
    text-align: right;
  }

  /* Input bar */
  .bar {
    display: flex;
    gap: .5rem;
    padding: .8rem 1rem;
    background: #fff;
    border-top: 2px solid rgba(255,45,120,.13);
    box-shadow: 0 -2px 14px rgba(255,45,120,.06);
    flex-shrink: 0;
  }

  .msginput {
    flex: 1;
    background: #fff0f6;
    border: 2px solid rgba(255,45,120,.2);
    border-radius: 14px;
    padding: .72rem 1rem;
    font-family: 'Syne', sans-serif;
    font-size: .9rem;
    color: #1a0010;
    outline: none;
    transition: border-color .2s, box-shadow .2s;
  }
  .msginput::placeholder { color: #ffb3d0; }
  .msginput:focus {
    border-color: #ff2d78;
    box-shadow: 0 0 0 3px rgba(255,45,120,.1);
    background: #fff;
  }

  .sendbtn {
    width: 46px; height: 46px;
    flex-shrink: 0;
    background: linear-gradient(135deg, #ff2d78, #ff5599);
    color: #fff;
    border: none;
    border-radius: 14px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    transition: transform .15s, box-shadow .15s, opacity .2s;
    box-shadow: 0 4px 16px rgba(255,45,120,.42);
  }
  .sendbtn:hover:not(:disabled) {
    transform: translateY(-2px) scale(1.05);
    box-shadow: 0 6px 22px rgba(255,45,120,.52);
  }
  .sendbtn:active:not(:disabled) { transform: scale(.94); }
  .sendbtn:disabled { opacity: .38; cursor: not-allowed; box-shadow: none; }
</style>