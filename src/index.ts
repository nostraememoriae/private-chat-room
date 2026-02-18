import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { sign, verify } from 'hono/jwt'
import { verifyToken } from './totp'

export { ChatRoom } from './ChatRoom'

type Variables = {
  user: string
}

interface CloudflareBindings {
  JWT_SECRET: string
  TOTP_SECRET_1: string
  TOTP_SECRET_2: string
  rooms: DurableObjectNamespace
}

type AppContext = { Bindings: CloudflareBindings; Variables: Variables }

const app = new Hono<AppContext>()

// --- Helpers ---

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: 'Strict' as const,
  path: '/',
}

async function verifyAuthCookie(token: string, secret: string): Promise<string> {
  if (!secret) throw new Error('JWT_SECRET is not set')
  const payload = await verify(token, secret, 'HS256')
  return payload.username as string
}

// --- Middleware ---

// Middleware to check authentication for /ws
app.use('/ws', async (c, next) => {
  const token = getCookie(c, 'auth')
  if (!token) return c.text('Unauthorized', 401)

  try {
    c.set('user', await verifyAuthCookie(token, c.env.JWT_SECRET))
    await next()
  } catch {
    return c.text('Unauthorized', 401)
  }
})

// --- Routes ---

app.post('/auth', async (c) => {
  const { code } = await c.req.json()
  const { TOTP_SECRET_1: secret1, TOTP_SECRET_2: secret2, JWT_SECRET } = c.env

  if (!secret1 || !secret2) {
    return c.json({ error: 'TOTP Secret not configured' }, 500)
  }

  // We check both secrets. Run checks in parallel.
  const [valid1, valid2] = await Promise.all([
    verifyToken(secret1, code),
    verifyToken(secret2, code),
  ])

  if (valid1 && valid2) {
    return c.json({ error: 'Just a small technical issue :), try again after a new code is generated.' }, 401)
  }

  const username = 
    valid1 ? 'User1' :
    valid2 ? 'User2' :
    null

  if (!username) return c.json({ error: 'Invalid TOTP code' }, 401)

  if (!JWT_SECRET) return c.json({ error: 'JWT Secret not configured' }, 500)

  // Generate JWT
  const token = await sign(
    { username, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 },
    JWT_SECRET
  )

  setCookie(c, 'auth', token, { ...COOKIE_OPTIONS, maxAge: 60 * 60 * 24 })
  return c.json({ success: true, username })
})

app.post('/logout', (c) => {
  setCookie(c, 'auth', '', { ...COOKIE_OPTIONS, maxAge: 0 })
  return c.json({ success: true })
})

app.get('/me', async (c) => {
  const token = getCookie(c, 'auth')
  if (!token) return c.json({ error: 'Unauthorized' }, 401)

  try {
    const username = await verifyAuthCookie(token, c.env.JWT_SECRET)
    return c.json({ username })
  } catch {
    return c.json({ error: 'Unauthorized' }, 401)
  }
})

app.get('/ws', async (c) => {
  if (c.req.header('Upgrade') !== 'websocket') {
    return c.text('Expected Upgrade: websocket', 426)
  }

  // Get the Durable Object ID for the single main room
  const id = c.env.rooms.idFromName('MainRoom')
  const room = c.env.rooms.get(id)

  // Pass username via URL search params — safer and more explicit than headers for DO forwarding
  const url = new URL(c.req.url)
  url.searchParams.set('username', c.get('user'))

  // Forward the request to the Durable Object
  return room.fetch(new Request(url.toString(), c.req.raw))
})

export default app