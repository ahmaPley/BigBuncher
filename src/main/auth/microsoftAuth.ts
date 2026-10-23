import { BrowserWindow, session } from 'electron'
import { randomUUID } from 'node:crypto'
import { fetchJson, HttpError, postJson } from '../core/http'

/**
 * Microsoft -> Xbox Live -> XSTS -> Minecraft Services login chain.
 * Uses the public client id of the official launcher (desktop redirect flow).
 */
const CLIENT_ID = '00000000402b5328'
const REDIRECT_URI = 'https://login.live.com/oauth20_desktop.srf'
const SCOPE = 'service::user.auth.xboxlive.com::MBI_SSL'

export interface MinecraftSession {
  uuid: string
  name: string
  accessToken: string
  expiresAt: number
  refreshToken: string
}

interface MsTokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number
}

interface XboxResponse {
  Token: string
  DisplayClaims: { xui: { uhs: string }[] }
}

/** Opens the Microsoft sign-in window and returns an authorization code. */
function requestAuthCode(): Promise<string> {
  const url =
    'https://login.live.com/oauth20_authorize.srf' +
    `?client_id=${CLIENT_ID}&response_type=code&prompt=select_account` +
    `&scope=${encodeURIComponent(SCOPE)}&redirect_uri=${encodeURIComponent(REDIRECT_URI)}`

  return new Promise((resolve, reject) => {
    const win = new BrowserWindow({
      width: 520,
      height: 680,
      title: 'Вход в Microsoft',
      autoHideMenuBar: true,
      backgroundColor: '#11161d',
      webPreferences: { session: session.fromPartition(`msauth-${randomUUID()}`) }
    })
    let finished = false

    const inspect = (target: string): void => {
      if (!target.startsWith(REDIRECT_URI)) return
      const params = new URL(target).searchParams
      finished = true
      win.close()
      const code = params.get('code')
      if (code) resolve(code)
      else reject(new Error(params.get('error_description') ?? 'Вход отменён'))
    }

    win.webContents.on('will-redirect', (_e, target) => inspect(target))
    win.webContents.on('did-navigate', (_e, target) => inspect(target))
    win.on('closed', () => {
      if (!finished) reject(new Error('Окно входа закрыто'))
    })
    void win.loadURL(url)
  })
}

function exchangeMsToken(params: Record<string, string>): Promise<MsTokenResponse> {
  return fetchJson<MsTokenResponse>('https://login.live.com/oauth20_token.srf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, scope: SCOPE, ...params })
  })
}

async function minecraftLoginWithMsToken(ms: MsTokenResponse): Promise<MinecraftSession> {
  const xbl = await postJson<XboxResponse>('https://user.auth.xboxlive.com/user/authenticate', {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: ms.access_token },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT'
  })

  let xsts: XboxResponse
  try {
    xsts = await postJson<XboxResponse>('https://xsts.auth.xboxlive.com/xsts/authorize', {
      Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
      RelyingParty: 'rp://api.minecraftservices.com/',
      TokenType: 'JWT'
    })
  } catch (err) {
    throw new Error(explainXstsError(err))
  }

  const uhs = xsts.DisplayClaims.xui[0].uhs
  const mc = await postJson<{ access_token: string; expires_in: number }>(
    'https://api.minecraftservices.com/authentication/login_with_xbox',
    { identityToken: `XBL3.0 x=${uhs};${xsts.Token}` }
  )

  let profile: { id: string; name: string }
  try {
    profile = await fetchJson('https://api.minecraftservices.com/minecraft/profile', {
      headers: { Authorization: `Bearer ${mc.access_token}` }
    })
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) {
      throw new Error('На этом аккаунте Microsoft не куплен Minecraft Java Edition')
    }
    throw err
  }

  return {
    uuid: profile.id,
    name: profile.name,
    accessToken: mc.access_token,
    expiresAt: Date.now() + (mc.expires_in - 60) * 1000,
    refreshToken: ms.refresh_token
  }
}

function explainXstsError(err: unknown): string {
  const body = err instanceof HttpError ? err.body : ''
  if (body.includes('2148916233')) return 'У аккаунта нет профиля Xbox. Зайдите на xbox.com и создайте его.'
  if (body.includes('2148916235')) return 'Xbox Live недоступен в вашей стране.'
  if (body.includes('2148916238')) return 'Детский аккаунт: его нужно добавить в семью Microsoft взрослым.'
  return 'Не удалось авторизоваться в Xbox Live'
}

export async function loginInteractive(): Promise<MinecraftSession> {
  const code = await requestAuthCode()
  const ms = await exchangeMsToken({ grant_type: 'authorization_code', code })
  return minecraftLoginWithMsToken(ms)
}

export async function refreshSession(refreshToken: string): Promise<MinecraftSession> {
  const ms = await exchangeMsToken({ grant_type: 'refresh_token', refresh_token: refreshToken })
  return minecraftLoginWithMsToken(ms)
}
