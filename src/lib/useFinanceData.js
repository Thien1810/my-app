// Hook nạp và ghi dữ liệu tài chính theo tháng (Supabase qua financeApi). Không dùng localStorage.
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  listAdsSpend,
  createAdsSpend,
  deleteAdsSpend,
  listFixedCosts,
  createFixedCost,
  deleteFixedCost,
  listFixedCostTemplates,
  createFixedCostTemplate,
  deleteFixedCostTemplate,
  applyFixedCostTemplates,
  listWarehouseShare,
  listWarehouses,
  listMonthLocks,
  lockMonth,
  unlockMonth,
  listMonthLockLog,
  listAdvancesByMonth,
  isMonthLockedLocal,
} from './financeApi'

export function useFinanceData({ month }) {
  const [loading, setLoading] = useState(true)
  const [adsRows, setAdsRows] = useState([])
  const [fixedCosts, setFixedCosts] = useState([])
  const [templates, setTemplates] = useState([])
  const [shares, setShares] = useState([])
  const [warehouses, setWarehouses] = useState([])
  const [locks, setLocks] = useState([])
  const [advances, setAdvances] = useState([])
  const [lockLog, setLockLog] = useState([])
  const [notice, setNotice] = useState(null)
  const [loadErrors, setLoadErrors] = useState([])
  const [reloadKey, setReloadKey] = useState(0)

  const fixedCostsRef = useRef([])
  const templatesRef = useRef([])
  const monthRef = useRef(month)
  useEffect(() => {
    monthRef.current = month
    fixedCostsRef.current = fixedCosts
    templatesRef.current = templates
  })

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      setLoading(true)
      const results = await Promise.all([
        listAdsSpend({ month }),
        listFixedCosts({ month }),
        listFixedCostTemplates(),
        listWarehouseShare(),
        listWarehouses(),
        listMonthLocks(),
        listAdvancesByMonth(month),
        listMonthLockLog(month),
      ])
      if (cancelled) return // tháng đã đổi hoặc unmount: bỏ kết quả cũ
      const [ads, fixed, tpl, share, wh, lk, adv, log] = results
      setAdsRows(ads.data || [])
      setFixedCosts(fixed.data || [])
      setTemplates(tpl.data || [])
      setShares(share.data || [])
      setWarehouses(wh.data || [])
      setLocks(lk.data || [])
      setAdvances(adv.data || [])
      setLockLog(log.data || []) // lỗi nhật ký (bảng chưa có) không chặn
      const names = ['Sổ Ads', 'Chi phí cứng', 'Mẫu', 'Tỷ trọng kho', 'Danh sách kho', 'Khóa sổ', 'Tạm ứng']
      const failed = results
        .slice(0, 7)
        .map((r, i) => (r.error ? names[i] : null))
        .filter(Boolean)
      setLoadErrors(failed)
      if (failed.length) {
        const firstErr = results.slice(0, 7).find((r) => r.error)
        setNotice({
          type: 'error',
          source: 'load',
          text: `Lỗi nạp dữ liệu tài chính (${failed.join(', ')}): ${firstErr.error.message}`,
        })
      } else {
        // Nạp thành công: chỉ xóa thông báo lỗi do nạp cũ, giữ thông báo của thao tác.
        setNotice((n) => (n && n.source === 'load' ? null : n))
      }
      setLoading(false)
    }
    load()
    return () => {
      cancelled = true
    }
  }, [month, reloadKey])

  const reload = useCallback(() => setReloadKey((k) => k + 1), [])

  // Chạy một lệnh ghi: lỗi -> notice lỗi nguyên văn; thành công -> notice + nạp lại.
  const run = useCallback(
    async (fn, successText) => {
      const { error } = await fn()
      if (error) {
        setNotice({ type: 'error', text: error.message })
        return false
      }
      setNotice({ type: 'success', text: successText })
      reload()
      return true
    },
    [reload],
  )

  const actions = {
    addAdsRow: (row) => run(() => createAdsSpend(row), 'Đã ghi dòng chi phí Ads vào sổ.'),
    removeAdsRow: (id) => run(() => deleteAdsSpend(id), 'Đã xóa dòng chi phí Ads.'),
    addFixedCost: (row) => run(() => createFixedCost(row), 'Đã ghi khoản chi phí cứng.'),
    removeFixedCost: (id) => run(() => deleteFixedCost(id), 'Đã xóa khoản chi phí cứng.'),
    applyTemplates: () =>
      run(() => applyFixedCostTemplates(monthRef.current), `Đã áp mẫu chi phí cứng vào tháng ${monthRef.current}.`),
    lockMonth: async (note) => {
      const { error } = await lockMonth(monthRef.current, note)
      if (error) {
        setNotice({ type: 'error', text: error.message })
        return false
      }
      setNotice({ type: 'success', text: `Đã khóa sổ tháng ${monthRef.current}.` })
      reload()
      return true
    },
    unlockMonth: async (reason) => {
      const { error } = await unlockMonth(monthRef.current, reason)
      if (error) {
        const missing =
          error.code === 'PGRST202' ||
          error.code === '42883' ||
          (/unlock_month/i.test(error.message || '') && /not find|does not exist|schema cache/i.test(error.message || ''))
        setNotice({
          type: 'error',
          text: missing
            ? 'Chưa mở khóa được: cần chạy file supabase/month_lock_controls.sql trên Supabase trước.'
            : error.message,
        })
        return false
      }
      setNotice({ type: 'success', text: `Đã mở khóa sổ tháng ${monthRef.current}.` })
      reload()
      return true
    },
    saveMonthAsTemplate: async () => {
      const current = fixedCostsRef.current
      if (!current.length) {
        setNotice({ type: 'error', text: `Tháng ${monthRef.current} chưa có chi phí cứng nào để lưu làm mẫu.` })
        return false
      }
      const errors = []
      for (const t of templatesRef.current) {
        const { error } = await deleteFixedCostTemplate(t.id)
        if (error) errors.push(error.message)
      }
      if (errors.length) {
        // Không tạo mẫu mới khi chưa xóa hết mẫu cũ, tránh nhân đôi.
        setNotice({ type: 'error', text: `Không xóa được mẫu cũ: ${errors[0]}` })
        reload()
        return false
      }
      let idx = 0
      for (const c of current) {
        const { error } = await createFixedCostTemplate({
          category: c.category,
          title: c.title,
          warehouse_code: c.warehouse_code || null,
          amount: c.amount,
          sort_order: idx++,
        })
        if (error) errors.push(error.message)
      }
      reload()
      if (errors.length) {
        setNotice({ type: 'error', text: `Lưu mẫu có ${errors.length} dòng lỗi: ${errors[0]}` })
        return false
      }
      setNotice({
        type: 'success',
        text: `Đã lưu ${current.length} khoản của tháng ${monthRef.current} thành mẫu hàng tháng.`,
      })
      return true
    },
  }

  return {
    loading,
    adsRows,
    fixedCosts,
    templates,
    shares,
    warehouses,
    locks,
    lockLog,
    advances,
    isLocked: isMonthLockedLocal(locks, month),
    loadErrors,
    hasLoadError: loadErrors.length > 0,
    notice,
    setNotice,
    reload,
    actions,
  }
}
