import { Hono } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import { sign, verify } from 'hono/jwt'
import { verifyToken } from './totp'

export { ChatRoom } from './ChatRoom'


// Environment bindings
type Variables = {
  user: string
}

interface CloudflareBindings {
  JWT_SECRET: string
  TOTP_SECRET_1: string
  TOTP_SECRET_2: string
  rooms: DurableObjectNamespace
}

const app = new Hono<{ Bindings: CloudflareBindings, Variables: Variables }>()

// Middleware to check authentication for /ws
app.use('/ws', async (c, next) => {
  const token = getCookie(c, 'auth')
  if (!token) {
    return c.text('Unauthorized', 401)
  }

  try {
    if (!c.env.JWT_SECRET) {
      throw new Error('JWT_SECRET is not set')
    }
    const payload = await verify(token, c.env.JWT_SECRET, 'HS256')
    c.set('user', payload.username as string) // Store username in context
    await next()
  } catch (e) {
    return c.text('Unauthorized', 401)
  }
})

// Auth endpoint
app.post('/auth', async (c) => {
  const { code } = await c.req.json()
  
  // Verify against secrets
  // We check both secrets.
  const secret1 = c.env.TOTP_SECRET_1
  const secret2 = c.env.TOTP_SECRET_2

  if (!secret1 || !secret2) {
    return c.json({ error: 'TOTP Secret not configured' }, 500)
  }

  // TOTP verification using standalone implementation
  let username = null
  
  // Run checks in parallel
  const [valid1, valid2] = await Promise.all([
    verifyToken(secret1, code),
    verifyToken(secret2, code)
  ])

  if (valid1 && valid2) {
    return c.json({ error: 'Just a small technical issue :), try again after a new code is generated.' }, 401)
  }

  if (valid1) {
    username = 'User1'
  } else if (valid2) {
    username = 'User2'
  }

  if (username) {
    // Generate JWT
    const secret = c.env.JWT_SECRET
    if (!secret) {
      return c.json({ error: 'JWT Secret not configured' }, 500)
    }
    const token = await sign({ username, exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30 }, secret) // 30 days

    // Set cookie
    setCookie(c, 'auth', token, {
      httpOnly: true,
      secure: true,
      sameSite: 'Strict',
      maxAge: 60 * 60 * 24 * 30,
      path: '/'
    })

    return c.json({ success: true, username })
  }

  return c.json({ error: 'Invalid TOTP code' }, 401)
})

app.post('/logout', (c) => {
  setCookie(c, 'auth', '', {
    httpOnly: true,
    secure: true,
    sameSite: 'Strict',
    maxAge: 0,
    path: '/'
  })
  return c.json({ success: true })
})

app.get('/me', async (c) => {
  const token = getCookie(c, 'auth')
  if (!token) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  try {
    if (!c.env.JWT_SECRET) {
      throw new Error('JWT_SECRET is not set')
    }
    const payload = await verify(token, c.env.JWT_SECRET, 'HS256')
    return c.json({ username: payload.username })
  } catch (e) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
})

// WebSocket endpoint
app.get('/ws', async (c) => {
  const upgrade = c.req.header('Upgrade')
  if (!upgrade || upgrade !== 'websocket') {
    return c.text('Expected Upgrade: websocket', 426)
  }

  // Get the Durable Object ID for the single main room
  const id = c.env.rooms.idFromName('MainRoom')
  const room = c.env.rooms.get(id)

  // Pass the username to the DO via URL params since headers might be stripped/standardized
  // However, standardized Request object preserves headers usually.
  // But URL search params is safer and explicit for DO.
  // We need to re-construct the request URL to include the username?
  // Actually, we can just fetch the DO with a modified URL.
  const url = new URL(c.req.url)
  // c.get('user') was set by middleware
  // We need to cast 'c' to something that has 'user' or just use 'any' context 
  // Hono context typing is tricky here without explicit Variable definition.
  const user = c.get('user') as string
  url.searchParams.set('username', user)

  // Forward the request to the Durable Object
  // We use the new Request object to ensure we pass everything correctly
  const newReq = new Request(url.toString(), c.req.raw)
  
  return room.fetch(newReq)
})

export default app
