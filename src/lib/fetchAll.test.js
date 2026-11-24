import { describe, it, expect } from 'vitest'
import { fetchAllRows } from './fetchAll'

// Query giả: bảng có `total` dòng, trả theo range; failAtCall (1-based) để giả lỗi.
function mockBuilder(total, failAtCall) {
  const calls = []
  const build = async (from, to) => {
    calls.push([from, to])
    if (failAtCall && calls.length === failAtCall) return { data: null, error: new Error('lỗi mạng') }
    const data = []
    for (let i = from; i <= Math.min(to, total - 1); i++) data.push({ id: i })
    return { data, error: null }
  }
  return { build, calls }
}

describe('fetchAllRows', () => {
  it('0 dòng', async () => {
    const m = mockBuilder(0)
    const r = await fetchAllRows(m.build, 10)
    expect(r).toEqual({ data: [], error: null })
    expect(m.calls).toEqual([[0, 9]])
  })

  it('đúng 1 trang (ít hơn pageSize)', async () => {
    const m = mockBuilder(7)
    const r = await fetchAllRows(m.build, 10)
    expect(r.data).toHaveLength(7)
    expect(m.calls).toHaveLength(1)
  })

  it('nhiều trang', async () => {
    const m = mockBuilder(25)
    const r = await fetchAllRows(m.build, 10)
    expect(r.error).toBeNull()
    expect(r.data.map((x) => x.id)).toEqual(Array.from({ length: 25 }, (_, i) => i))
    expect(m.calls).toEqual([[0, 9], [10, 19], [20, 29]])
  })

  it('trang cuối đúng bằng pageSize: gọi thêm một trang trống rồi dừng', async () => {
    const m = mockBuilder(20)
    const r = await fetchAllRows(m.build, 10)
    expect(r.data).toHaveLength(20)
    expect(m.calls).toEqual([[0, 9], [10, 19], [20, 29]])
  })

  it('lỗi giữa chừng: trả lỗi ngay, không gọi tiếp', async () => {
    const m = mockBuilder(50, 2)
    const r = await fetchAllRows(m.build, 10)
    expect(r.data).toBeNull()
    expect(r.error.message).toBe('lỗi mạng')
    expect(m.calls).toHaveLength(2)
  })
})
