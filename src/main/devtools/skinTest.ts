/**
 * BIGBUNCHER_SMOKE=skins — skins of other players: a nick learned from the game log is found on Ely.by/Mojang and
 * served re-signed by the local server; our own skin is shared over the LAN endpoint. Temporary settings folder.
 */
export async function runSkinTest(): Promise<void> {
  const ygg = await import('../skins/yggdrasilServer')
  const net = await import('../skins/skinNetwork')
  const { emit } = await import('../core/events')
  const log = (...a: unknown[]): void => console.log('[skins]', ...a)
  const check = (ok: unknown, what: string): void => {
    if (!ok) throw new Error(`FAIL: ${what}`)
    log('ok:', what)
  }

  const root = await ygg.ensureYggdrasilServer()
  // A 64×64 transparent PNG is enough for an "own" skin.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAEAAAABACAYAAACqaXHeAAAAJ0lEQVR42u3BAQ0AAADCoPdPbQ43oAAAAAAAAAAAAAAAAAAAAAAAvg0wQAABJ8yXpQAAAABJRU5ErkJggg==',
    'base64'
  )
  const me = { uuid: net.offlineUuid('TambiTester'), name: 'TambiTester', skin: { png, model: 'classic' as const } }
  ygg.registerProfile(me)
  await net.startSkinSharing(ygg.ownProfiles)

  // The game log says somebody joined — the server should now know their skin.
  emit('gameLog', { instanceId: 'test', line: '[Server thread/INFO]: Notch joined the game', stream: 'out' })
  const notch = net.offlineUuid('Notch')
  check(net._skinNetworkTest.names.get(notch) === 'Notch', 'ник выучен из лога игры')

  const res = await fetch(`${root}sessionserver/session/minecraft/profile/${notch}?unsigned=false`)
  check(res.status === 200, `профиль чужого игрока отдан (${res.status})`)
  const body = (await res.json()) as { name: string; properties: { name: string; value: string; signature?: string }[] }
  const prop = body.properties[0]
  check(prop.signature, 'профиль подписан нашим ключом')
  const textures = JSON.parse(Buffer.from(prop.value, 'base64').toString()) as { textures: { SKIN?: { url: string } } }
  log('skin url:', textures.textures.SKIN?.url)
  check(textures.textures.SKIN, 'у Notch найден скин (Ely.by/Mojang)')
  const tex = await fetch(textures.textures.SKIN!.url)
  check(tex.ok && (await tex.arrayBuffer()).byteLength > 100, 'текстура скина отдаётся локальным сервером')

  const lookup = await fetch(`${root}api/profiles/minecraft`, { method: 'POST', body: JSON.stringify(['SomeRandomNick']) })
  const ids = (await lookup.json()) as { id: string }[]
  check(ids[0]?.id === net.offlineUuid('SomeRandomNick'), 'неизвестный ник → офлайн-UUID')

  // LAN endpoint serves only our own accounts.
  const lan = net._skinNetworkTest
  log('LAN peers seen:', lan.peers.size)
  log('ВСЁ ОК')
}
