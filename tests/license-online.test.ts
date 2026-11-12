import { beforeEach, expect, test, vi } from 'vitest'
const h = vi.hoisted(() => ({ settings: new Map<string, unknown>(), active: null as string | null }))
vi.mock('electron', () => ({ app: { getVersion: () => 'test' } }))
vi.mock('../src/main/db', () => ({
  getSetting: (key: string, fallback: unknown) => h.settings.get(key) ?? fallback,
  setSetting: (key: string, value: unknown) => h.settings.set(key, value)
}))
vi.mock('../src/main/machine', () => ({ machineHash: () => 'device', machineName: () => 'test' }))
vi.mock('../src/main/secure', () => ({
  sealString: (s: string) => `sealed:${s}`,
  unsealString: (s: string) => s.slice(7)
}))
vi.mock('../src/main/log', () => ({ log: { info: vi.fn(), warn: vi.fn() } }))
vi.mock('../src/main/license', () => ({
  parseLicense: (key: string) => ({ id: key, online: true }),
  activateLicense: (key: string) => {
    h.active = key
  },
  invalidateLicenseCache: () => {},
  removeLicense: () => {
    h.active = null
  },
  licenseStatus: () => ({
    state: h.active ? 'active' : 'none',
    payload: h.active ? { id: h.active } : null,
    maxAccounts: h.active === 'L2' ? 2 : 1
  })
}))
import { loginOnline, logoutOnline, refreshOnline } from '../src/main/license-online'
const options = [
  { id: 'L1', plano: 'completo', contas: 8, teste: false, fim: null, status: 'active' },
  { id: 'L2', plano: 'basico', contas: 2, teste: false, fim: null, status: 'active' }
]
beforeEach(() => {
  h.settings.clear()
  h.active = null
  vi.unstubAllGlobals()
})
const respond = (data: unknown): void => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(data)))
  )
}
test('múltiplas opções não ativam licença nem persistem credenciais/sessão', async () => {
  respond({ ok: true, selectionRequired: true, licenses: options })
  expect(await loginOnline('cliente@example.test', 'memory-only')).toEqual({
    selectionRequired: true,
    licenses: options
  })
  expect(h.active).toBeNull()
  expect(h.settings.size).toBe(0)
})
test('licença escolhida envia ID e usa apenas sua quota, sem somar outras', async () => {
  respond({ ok: true, key: 'L2', session: 'session-2' })
  const result = await loginOnline('cliente@example.test', 'memory-only', 'L2')
  expect(result).toMatchObject({ payload: { id: 'L2' }, maxAccounts: 2 })
  const call = vi.mocked(fetch).mock.calls[0][1]!
  expect(JSON.parse(call.body as string).licenseId).toBe('L2')
  expect(call.redirect).toBe('error')
  expect(h.settings.get('license_session')).toBe('sealed:session-2')
  expect(JSON.stringify([...h.settings])).not.toContain('memory-only')
})
test('uma licença continua ativação automática sem licenseId', async () => {
  respond({ ok: true, key: 'L1', session: 's' })
  expect(await loginOnline('cliente@example.test', 'pw')).toMatchObject({ payload: { id: 'L1' } })
})
test('resposta para licença diferente é recusada sem trocar licença atual', async () => {
  h.active = 'L1'
  respond({ ok: true, key: 'L1', session: 'wrong' })
  await expect(loginOnline('cliente@example.test', 'pw', 'L2')).rejects.toThrow(/licença escolhida/)
  expect(h.active).toBe('L1')
  expect(h.settings.has('license_session')).toBe(false)
})
test('refresh não troca licença escolhida nem aceita resposta de sessão antiga', async () => {
  h.active = 'L2'
  h.settings.set('license_session', 'sealed:s2')
  respond({ ok: true, key: 'L1' })
  await refreshOnline()
  expect(h.active).toBe('L2')
})
test('licença indisponível remove só a licença; seleção obrigatória encerra sessão legada', async () => {
  h.active = 'L2'
  h.settings.set('license_session', 'sealed:s2')
  respond({ ok: false, code: 'licenca_indisponivel' })
  await refreshOnline()
  expect(h.active).toBeNull()
  expect(h.settings.get('license_session')).toBe('sealed:s2')
  respond({ ok: false, code: 'selecionar_licenca' })
  await refreshOnline()
  expect(h.settings.get('license_session')).toBeNull()
})
test('login duplicado é recusado; logout impede aplicar resposta de login pendente', async () => {
  let reply!: (r: Response) => void
  vi.stubGlobal(
    'fetch',
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          reply = resolve
        })
    )
  )
  const pending = loginOnline('cliente@example.test', 'pw')
  await expect(loginOnline('outro@example.test', 'pw')).rejects.toThrow(/andamento/)
  await logoutOnline()
  reply(new Response(JSON.stringify({ ok: true, key: 'L2', session: 's2' })))
  await expect(pending).rejects.toThrow(/cancelada/)
  expect(h.active).toBeNull()
})

test('licença removida por indisponibilidade continua presa à escolha no próximo refresh', async () => {
  respond({ ok: true, key: 'L2', session: 's2' })
  await loginOnline('cliente@example.test', 'pw', 'L2')
  respond({ ok: false, code: 'licenca_indisponivel' })
  await refreshOnline()
  expect(h.active).toBeNull()
  respond({ ok: true, key: 'L1' })
  await refreshOnline()
  expect(h.active).toBeNull()
  respond({ ok: true, key: 'L2' })
  await refreshOnline()
  expect(h.active).toBe('L2')
})

test('logout lento não apaga login de outra conta concluído durante a rede', async () => {
  h.active = 'L1'
  h.settings.set('license_session', 'sealed:s1')
  let finishLogout!: (r: Response) => void
  vi.stubGlobal(
    'fetch',
    vi.fn(async (_url, init) => {
      if (JSON.parse(init?.body as string).session === 's1')
        return new Promise<Response>((resolve) => {
          finishLogout = resolve
        })
      return new Response(JSON.stringify({ ok: true, key: 'L2', session: 's2' }))
    })
  )
  const logout = logoutOnline()
  await loginOnline('outra@example.test', 'pw', 'L2')
  finishLogout(new Response(JSON.stringify({ ok: true })))
  await logout
  expect(h.active).toBe('L2')
  expect(h.settings.get('license_session')).toBe('sealed:s2')
})

test('respostas malformadas ou cotas inválidas não são ativadas nem persistidas', async () => {
  respond(null)
  await expect(loginOnline('cliente@example.test', 'pw')).rejects.toThrow(/dados inválidos/)
  respond({ ok: true, selectionRequired: true, licenses: [{ ...options[0], contas: -1 }, options[1]] })
  await expect(loginOnline('cliente@example.test', 'pw')).rejects.toThrow(/licenças disponíveis/)
  expect(h.active).toBeNull()
  expect(h.settings.size).toBe(0)
})
