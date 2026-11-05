/**
 * Converte áudio Opus gravado pelo navegador (WebM) para Ogg/Opus, formato exigido
 * pelo WhatsApp em mensagens de voz. Não recodifica: só troca o "envelope" (remux).
 */

const ID = {
  Segment: 0x18538067,
  Cluster: 0x1f43b675,
  Tracks: 0x1654ae6b,
  TrackEntry: 0xae,
  CodecPrivate: 0x63a2,
  SimpleBlock: 0xa3,
  BlockGroup: 0xa0,
  Block: 0xa1,
  EBML: 0x1a45dfa3
}
const MASTERS = new Set([ID.Segment, ID.Cluster, ID.Tracks, ID.TrackEntry, ID.BlockGroup])

function readVint(b: Uint8Array, pos: number, keepMarker: boolean): { value: number; len: number; unknown: boolean } {
  const first = b[pos]
  let len = 1
  while (len <= 8 && !(first & (0x80 >> (len - 1)))) len++
  if (len > 8) throw new Error('WebM inválido')
  let value = keepMarker ? first : first & (0xff >> len)
  let allOnes = (first & (0xff >> len)) === 0xff >> len
  for (let i = 1; i < len; i++) {
    value = value * 256 + b[pos + i]
    if (b[pos + i] !== 0xff) allOnes = false
  }
  return { value, len, unknown: !keepMarker && allOnes }
}

export function webmOpusPackets(webm: Uint8Array): { head: Uint8Array | null; packets: Uint8Array[] } {
  const packets: Uint8Array[] = []
  let head: Uint8Array | null = null
  let pos = 0
  while (pos < webm.length - 2) {
    const id = readVint(webm, pos, true)
    const size = readVint(webm, pos + id.len, false)
    const dataStart = pos + id.len + size.len
    if (MASTERS.has(id.value)) {
      pos = dataStart // entra no elemento (funciona também com tamanho desconhecido)
      continue
    }
    const end = size.unknown ? webm.length : Math.min(webm.length, dataStart + size.value)
    if (id.value === ID.CodecPrivate) head = webm.slice(dataStart, end)
    if (id.value === ID.SimpleBlock || id.value === ID.Block) {
      const track = readVint(webm, dataStart, false)
      const flags = webm[dataStart + track.len + 2]
      if ((flags & 0x06) !== 0) throw new Error('WebM com lacing não suportado')
      packets.push(webm.slice(dataStart + track.len + 3, end))
    }
    pos = end
  }
  return { head, packets }
}

/** Amostras (48 kHz) de um pacote Opus, a partir do byte TOC. */
export function opusSamples(p: Uint8Array): number {
  if (!p.length) return 0
  const toc = p[0]
  const config = toc >> 3
  let ms: number
  if (config < 12) ms = [10, 20, 40, 60][config % 4]
  else if (config < 16) ms = [10, 20][config % 2]
  else ms = [2.5, 5, 10, 20][config % 4]
  const c = toc & 3
  const frames = c === 0 ? 1 : c === 3 ? (p[1] ?? 0) & 0x3f : 2
  return Math.round(ms * 48 * frames)
}

// CRC do Ogg (polinômio 0x04C11DB7, sem reflexão)
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let r = i << 24
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? (r << 1) ^ 0x04c11db7 : r << 1
    t[i] = r >>> 0
  }
  return t
})()

function crc(data: Uint8Array): number {
  let c = 0
  for (const byte of data) c = ((c << 8) ^ CRC_TABLE[((c >>> 24) & 0xff) ^ byte]) >>> 0
  return c >>> 0
}

function page(packet: Uint8Array, granule: bigint, serial: number, seq: number, flags: number): Uint8Array {
  const lacing: number[] = []
  let n = packet.length
  while (n >= 255) {
    lacing.push(255)
    n -= 255
  }
  lacing.push(n)
  if (lacing.length > 255) throw new Error('Pacote Opus grande demais')
  const header = new Uint8Array(27 + lacing.length)
  const dv = new DataView(header.buffer)
  header.set([0x4f, 0x67, 0x67, 0x53], 0) // OggS
  header[4] = 0
  header[5] = flags
  dv.setBigInt64(6, granule, true)
  dv.setUint32(14, serial, true)
  dv.setUint32(18, seq, true)
  dv.setUint32(22, 0, true)
  header[26] = lacing.length
  header.set(lacing, 27)
  const out = new Uint8Array(header.length + packet.length)
  out.set(header, 0)
  out.set(packet, header.length)
  new DataView(out.buffer).setUint32(22, crc(out), true)
  return out
}

function defaultHead(channels = 1): Uint8Array {
  const h = new Uint8Array(19)
  h.set(new TextEncoder().encode('OpusHead'), 0)
  h[8] = 1
  h[9] = channels
  new DataView(h.buffer).setUint16(10, 312, true)
  new DataView(h.buffer).setUint32(12, 48000, true)
  return h
}

function tags(): Uint8Array {
  const vendor = new TextEncoder().encode('Disparador')
  const t = new Uint8Array(8 + 4 + vendor.length + 4)
  t.set(new TextEncoder().encode('OpusTags'), 0)
  new DataView(t.buffer).setUint32(8, vendor.length, true)
  t.set(vendor, 12)
  return t
}

export function webmToOgg(webm: Uint8Array): { ogg: Uint8Array; seconds: number } {
  const { head: rawHead, packets } = webmOpusPackets(webm)
  if (!packets.length) throw new Error('Gravação vazia')
  const head =
    rawHead && rawHead.length >= 19 && new TextDecoder().decode(rawHead.slice(0, 8)) === 'OpusHead'
      ? rawHead
      : defaultHead()
  const preSkip = new DataView(head.buffer, head.byteOffset).getUint16(10, true)
  const serial = (Math.random() * 0xffffffff) >>> 0
  const pages: Uint8Array[] = [page(head, 0n, serial, 0, 0x02), page(tags(), 0n, serial, 1, 0)]
  let granule = 0n
  let samples = 0
  packets.forEach((p, i) => {
    const s = opusSamples(p)
    samples += s
    granule += BigInt(s)
    pages.push(page(p, granule, serial, i + 2, i === packets.length - 1 ? 0x04 : 0))
  })
  const total = pages.reduce((n, p) => n + p.length, 0)
  const ogg = new Uint8Array(total)
  let off = 0
  for (const p of pages) {
    ogg.set(p, off)
    off += p.length
  }
  return { ogg, seconds: Math.max(1, Math.round((samples - preSkip) / 48000)) }
}
