import * as XLSX from 'xlsx'

export function exportToExcel(rows, sheetName = 'DuLieu', fileName = 'xuat-du-lieu.xlsx') {
  const safeRows = rows && rows.length > 0 ? rows : [{ 'Thông báo': 'Không có dữ liệu' }]
  const worksheet = XLSX.utils.json_to_sheet(safeRows)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName.slice(0, 31))
  const finalName = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`
  XLSX.writeFile(workbook, finalName)
}

export function exportMultiSheetExcel(sheets, fileName = 'toan-bo-du-lieu.xlsx') {
  const workbook = XLSX.utils.book_new()
  for (const { name, rows } of sheets) {
    const safeRows = rows && rows.length > 0 ? rows : [{ 'Thông báo': 'Không có dữ liệu' }]
    const worksheet = XLSX.utils.json_to_sheet(safeRows)
    XLSX.utils.book_append_sheet(workbook, worksheet, name.slice(0, 31))
  }
  const finalName = fileName.endsWith('.xlsx') ? fileName : `${fileName}.xlsx`
  XLSX.writeFile(workbook, finalName)
}

export async function exportAllRawData(supabase, role) {
  const canSeeFinance = role === 'admin' || role === 'manager'
  const tables = [
    { table: 'item_stock', sheet: 'TonKho_item_stock' },
    { table: 'items', sheet: 'VatTu_items' },
    { table: 'partners', sheet: 'DoiTac_partners' },
    { table: 'projects', sheet: 'DuAn_projects' },
    { table: 'project_plan', sheet: 'KeHoach_project_plan' },
    { table: 'project_members', sheet: 'ThanhVien_members' },
    { table: 'set_templates', sheet: 'MauSet_templates' },
    { table: 'set_template_items', sheet: 'ChiTietSet_items' },
    { table: 'stock_movements', sheet: 'SoKho_movements' },
    { table: 'profiles', sheet: 'NguoiDung_profiles' },
  ]

  if (canSeeFinance) {
    tables.push(
      { table: 'project_finance', sheet: 'TaiChinh_finance' },
      { table: 'project_costs', sheet: 'ChiPhiKhac_costs' }
    )
  }

  const sheets = []
  for (const t of tables) {
    const { data, error } = await supabase.from(t.table).select('*')
    if (!error && data) {
      sheets.push({ name: t.sheet, rows: data })
    } else {
      sheets.push({ name: t.sheet, rows: [] })
    }
  }

  const dateTag = new Date().toISOString().slice(0, 10)
  exportMultiSheetExcel(sheets, `du-lieu-tho-kho-trang-tri-${dateTag}.xlsx`)
}
