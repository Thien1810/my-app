import { describe, expect, it } from 'vitest'
import { ITEM_CATEGORY_PRESETS } from './formatters'
import {
  buildCategoryOptions,
  deriveCategoriesFromItems,
  findDuplicateCategory,
  findSimilarCategories,
  generateCategoryCode,
  groupItemsByKindAndCategory,
  isItemCodeLocked,
  normalizeCategoryName,
  sortItems,
} from './itemCategories'

describe('tên và mã danh mục', () => {
  it('xử lý danh sách rỗng mà không cần bảng danh mục', () => {
    expect(findDuplicateCategory('Hoa', null, [])).toBeNull()
    expect(findSimilarCategories('Hoa', [])).toEqual([])
    expect(generateCategoryCode('', [])).toBe('VT')
    expect(deriveCategoriesFromItems([])).toEqual([])
    expect(groupItemsByKindAndCategory([], [])).toEqual([])
    expect(sortItems([])).toEqual([])
    expect(buildCategoryOptions([])).toEqual([])
  })

  it('giữ đủ mã preset và vẫn trả tên trùng sau chuẩn hóa để người dùng biết đã có', () => {
    for (const preset of ITEM_CATEGORY_PRESETS) {
      expect(generateCategoryCode(normalizeCategoryName(preset.name), [])).toBe(preset.code)
    }
    expect(findSimilarCategories(' HOA & LÁ ', [{ name: 'hoa la' }, { name: 'Đèn' }])).toEqual([{ name: 'hoa la' }])
    expect(normalizeCategoryName('Hoa & Lá')).not.toBe(normalizeCategoryName('Hoa và Lá'))
  })

  it('chuẩn hóa dấu, đ, khoảng trắng và dấu câu, giữ chữ và số Unicode', () => {
    expect(normalizeCategoryName('   ĐÈN /  Ánh sáng — 2 東京!   ')).toBe('den anh sang 2 東京')
    expect(normalizeCategoryName('Hoa & Lá')).toBe('hoa la')
    expect(normalizeCategoryName(null)).toBe('')
  })

  it('chỉ báo trùng tên cùng cấp cha và bỏ mục đang sửa', () => {
    const categories = [
      { id: 1, parent_id: 10, name: 'Hoa & Lá' },
      { id: 2, parent_id: 20, name: 'HOA LÁ', active: false },
      { id: null, parent_id: null, name: 'Hoa Lá' },
    ]
    expect(findDuplicateCategory('hoa / la', '10', categories)).toBe(categories[0])
    expect(findDuplicateCategory('hoa la', 20, categories)).toBe(categories[1])
    expect(findDuplicateCategory('hoa la', 10, categories, '1')).toBeNull()
    expect(findDuplicateCategory('hoa la', undefined, categories)).toBe(categories[2])
    expect(findDuplicateCategory('!?', null, categories)).toBeNull()
  })

  it('gợi ý cùng từ, chứa tên hoặc lệch một ký tự và bỏ tên trùng', () => {
    const categories = [
      { name: 'Hoa & Lá' },
      { name: 'Hoa Giấy' },
      { name: 'Hoa Giấy Lớn' },
      { name: 'Hoo Giấy' },
      { name: 'Hooi Giấy' },
      { name: 'Vải' },
    ]
    expect(findSimilarCategories('hoa-giay', categories)).toEqual([categories[1], categories[2], categories[3]])
    expect(findSimilarCategories('hoa-giay', categories, 1)).toEqual([categories[1]])
    expect(findSimilarCategories('backdrop', [{ name: 'backdrp' }])).toEqual([{ name: 'backdrp' }])
    expect(findSimilarCategories('backdrop', [{ name: 'backdropx' }])).toEqual([{ name: 'backdropx' }])
    expect(findSimilarCategories('!', categories)).toEqual([])
    expect(findSimilarCategories('hoa giay', categories, 0)).toEqual([])
  })

  it('ưu tiên mã gợi ý và thêm hậu tố khi trùng, kể cả nhóm ngưng dùng', () => {
    expect(generateCategoryCode(' ĐÈN / ÁNH SÁNG  ', [])).toBe('DEN')
    expect(generateCategoryCode('Hoa Lá', [{ code: 'hoa' }, { code: ' Hoa2 ', active: false }])).toBe('HOA3')
    expect(generateCategoryCode('🚲', [{ code: 'vt' }])).toBe('VT2')

    const used = Array.from({ length: 102 }, (_, index) => ({
      code: index === 0 ? 'BACKDR' : `${'BACKDR'.slice(0, 8 - String(index + 1).length)}${index + 1}`,
    }))
    expect(generateCategoryCode('backdrop', used)).toBe('BACKD103')
  })

  it('gom nhóm cũ theo tên chuẩn hóa và giữ tên hiển thị gặp đầu tiên', () => {
    const items = [
      { category: '  Hoa   & Lá  ' },
      { category: 'hoa la' },
      { category: ' ## ' },
      {},
      { category: 'Hoa giấy', active: false },
    ]
    expect(deriveCategoriesFromItems(items)).toEqual([
      { id: null, virtual: true, name: 'Hoa & Lá', code: 'HOA', parent_id: null, sort_order: 100, active: true },
      { id: null, virtual: true, name: 'Hoa giấy', code: 'HOA2', parent_id: null, sort_order: 101, active: true },
    ])
  })

  it('mã nhóm ảo không trùng mã nhóm thật', () => {
    expect(deriveCategoriesFromItems([{ category: 'Hoa' }], [{ code: 'hoa' }])[0].code).toBe('HOA2')
    expect(deriveCategoriesFromItems([{ category: 'Hoa' }, { category: 'Hoa lá' }], [{ code: 'HOA' }, { code: 'HOA2' }])
      .map(({ code }) => code)).toEqual(['HOA3', 'HOA4'])
    expect(deriveCategoriesFromItems(null, null)).toEqual([])
  })

  it('findSimilarCategories bỏ từ ngắn, từ toàn số và so chứa nhau theo ranh giới từ', () => {
    expect(findSimilarCategories('hoa', [{ name: 'Khoa' }])).toEqual([])
    expect(findSimilarCategories('ban', [{ name: 'Băng keo' }])).toEqual([])
    expect(findSimilarCategories('Hoa la', [{ name: 'Đèn la' }])).toEqual([])
    expect(findSimilarCategories('Tiệc 2024', [{ name: 'Cưới 2024' }])).toEqual([])
    expect(findSimilarCategories('hoa', [{ name: 'Hoa lụa' }])).toEqual([{ name: 'Hoa lụa' }])
  })

  it('findSimilarCategories hỗ trợ đảo hai ký tự, excludeId và tên trùng ở nhóm cha khác', () => {
    expect(findSimilarCategories('bakcdrop', [{ name: 'backdrop' }])).toEqual([{ name: 'backdrop' }])
    const list = [{ id: 1, name: 'Hoa giấy' }, { id: 2, name: 'Hoa lụa' }]
    expect(findSimilarCategories('Hoa giấy', list)[0]).toBe(list[0])
    expect(findSimilarCategories('Hoa giấy', list, 3, '1')).toEqual([list[1]])
    expect(findSimilarCategories('Hoa giấy', list, 3, 1)).toEqual([list[1]])
    const otherParent = [{ id: 9, parent_id: 5, name: 'Hoa' }]
    expect(findSimilarCategories('hoa', otherParent)).toEqual(otherParent)
  })

  it('categories null hoặc undefined được coi là danh sách rỗng ở mọi hàm', () => {
    for (const empty of [null, undefined]) {
      expect(findDuplicateCategory('Hoa', null, empty)).toBeNull()
      expect(findSimilarCategories('Hoa', empty)).toEqual([])
      expect(generateCategoryCode('Hoa', empty)).toBe('HOA')
      expect(buildCategoryOptions(empty)).toEqual([])
      expect(groupItemsByKindAndCategory([{ kind: 'reusable', category: 'Hoa' }], empty)[0].groups[0].category.name)
        .toBe('Hoa')
      expect(groupItemsByKindAndCategory(empty, empty)).toEqual([])
      expect(sortItems(empty)).toEqual([])
    }
  })
})

const categories = Object.freeze([
  { id: 5, name: 'Hoa giấy', parent_id: 4, sort_order: 1 },
  { id: 3, name: 'Hoa giấy', parent_id: 1, sort_order: 2 },
  { id: 1, name: 'Hoa & Lá', sort_order: 1, active: false },
  { id: 6, name: 'Nhóm mồ côi', parent_id: 999, sort_order: 3 },
  { id: 2, name: 'Hoa lụa', parent_id: 1, sort_order: 1, active: false },
  { id: 4, name: 'Phụ kiện', sort_order: 1, default_kind: 'consumable' },
].map(Object.freeze))

const items = Object.freeze([
  { id: 1, kind: 'reusable', name: 'Hoa B', category_id: '1', category: 'Phụ kiện', in_stock: 1, min_stock: 3 },
  { id: 2, kind: 'reusable', name: 'Hoa A', category_id: 2, code: 'TSD-HOA-001', in_stock: '3', min_stock: '3' },
  { id: 3, kind: 'reusable', name: 'Hoa C', category: 'hoa-LUA', in_stock: '2', min_stock: '3' },
  { id: 4, kind: 'consumable', category: 'Hoa Giấy', note: '[Màu: Đỏ tươi] ghi chú' },
  { id: 5, kind: 'reusable', category: 'Rèm vải', min_stock: 0 },
  { id: 6, kind: 'reusable', category_id: 6, min_stock: -1 },
  { id: 7, kind: 'reusable', category_id: 4, active: false, min_stock: 1 },
  { id: 8, kind: 'consumable', category_id: 3 },
  { id: 9, kind: 'consumable', category_id: 5 },
  { id: 10, kind: 'reusable', category_id: 4 },
].map(Object.freeze))

describe('gom vật tư theo loại và danh mục', () => {
  it('ưu tiên thứ tự số trước tên và giữ nhóm chưa phân cuối ở cả hai loại', () => {
    const list = [
      { id: 'a', name: 'Áo', sort_order: 20 },
      { id: 'v', name: 'Vải', sort_order: -2 },
      { id: 'c1', name: 'Áo con', parent_id: 'v', sort_order: 9 },
      { id: 'c2', name: 'Vải con', parent_id: 'v', sort_order: 1 },
    ]
    const result = groupItemsByKindAndCategory([], list, { hideEmpty: false })
    for (const section of result) {
      expect(section.groups.map(({ category }) => category.id)).toEqual(['v', 'a', null])
      expect(section.groups[0].subgroups.map(({ category }) => category.id)).toEqual(['c2', 'c1'])
    }
  })

  it('đếm tồn thấp đúng ở ngưỡng bằng nhau, thiếu số và số dạng chuỗi', () => {
    const stockItems = [
      { min_stock: 1 },
      { min_stock: '2', in_stock: '1' },
      { min_stock: 2, in_stock: 2 },
      { min_stock: 2, in_stock: 3 },
      { min_stock: 0, in_stock: -1 },
      { min_stock: -1, in_stock: -2 },
      { in_stock: -1 },
    ].map((item) => ({ ...item, kind: 'consumable' }))
    const [section] = groupItemsByKindAndCategory(stockItems, [])
    expect(section).toMatchObject({ itemCount: 7, lowStockCount: 2 })
    expect(section.groups).toHaveLength(1)
    expect(section.groups[0]).toMatchObject({
      category: { id: null, virtual: true, name: 'Chưa phân nhóm' },
      itemCount: 7, lowStockCount: 2, subgroups: [],
    })
  })

  it('không sửa dữ liệu nguồn hoặc dùng lại mảng kết quả giữa các lần gọi', () => {
    const before = JSON.stringify({ items, categories })
    const result = groupItemsByKindAndCategory(items, categories)
    const flowerGroup = result[0].groups.find(({ category }) => category.id === 1)
    flowerGroup.items.pop()
    flowerGroup.subgroups.length = 0
    expect(groupItemsByKindAndCategory(items, categories)[0].groups.find(({ category }) => category.id === 1))
      .toMatchObject({ itemCount: 3, items: [items[0]], subgroups: [{ itemCount: 2 }] })
    expect(JSON.stringify({ items, categories })).toBe(before)
  })

  it('xếp TSD trước TH, giữ vật tư nhóm ngưng và đếm cha gồm con', () => {
    const [reusable, consumable] = groupItemsByKindAndCategory(items, categories)
    expect(reusable).toMatchObject({ kind: 'reusable', label: 'Tái sử dụng', itemCount: 6, lowStockCount: 2 })
    expect(consumable).toMatchObject({ kind: 'consumable', label: 'Tiêu hao', itemCount: 3, lowStockCount: 0 })
    const flowerGroup = reusable.groups.find(({ category }) => category.id === 1)
    expect(flowerGroup).toMatchObject({
      itemCount: 3,
      lowStockCount: 2,
      items: [items[0]],
      subgroups: [{ category: { id: 2 }, itemCount: 2, lowStockCount: 1, items: [items[1], items[2]] }],
    })
    expect(reusable.groups.filter(({ category }) => category.id === 4)[0].items).toEqual([items[9]])
    expect(reusable.groups.some(({ category }) => category.id === 6)).toBe(true)
    expect(reusable.groups.some(({ category }) => category.virtual && category.name === 'Rèm vải')).toBe(true)
    expect(consumable.groups.slice(0, 2).map(({ subgroups }) => subgroups[0].category.id)).toEqual([3, 5])
    expect(consumable.groups.at(-1)).toMatchObject({ category: { name: 'Chưa phân nhóm' }, items: [items[3]] })
  })

  it('lọc loại, tìm không dấu theo mã, tên, tên nhóm cha, nhóm cũ và màu', () => {
    const result = (search) => groupItemsByKindAndCategory(items, categories, { kind: 'reusable', search })
    expect(result('hoa & la')).toMatchObject([{ itemCount: 3, lowStockCount: 2 }])
    expect(result('hoa la')).toMatchObject([{ itemCount: 3, lowStockCount: 2 }])
    expect(result('hoa a')).toMatchObject([{ itemCount: 1, lowStockCount: 0 }])
    expect(result('TSD-HOA-001')).toMatchObject([{ itemCount: 1, lowStockCount: 0 }])
    expect(result('rem vai')).toMatchObject([{ itemCount: 1, lowStockCount: 0 }])
    expect(groupItemsByKindAndCategory(items, categories, { search: 'do tuoi' })).toMatchObject([
      { kind: 'consumable', itemCount: 1 },
    ])
    expect(result('khong tim thay')).toEqual([])
  })

  it('hiện nhóm và loại rỗng theo tùy chọn, sắp nhóm theo thứ tự rồi tên', () => {
    const [reusable, consumable] = groupItemsByKindAndCategory([], categories, { hideEmpty: false })
    expect(reusable.itemCount).toBe(0)
    expect(consumable.itemCount).toBe(0)
    expect(reusable.groups.map(({ category }) => category.id)).toEqual([1, 4, 6, null])
    expect(reusable.groups[0].subgroups.map(({ category }) => category.id)).toEqual([2, 3])
    expect(reusable.groups.at(-1).category.name).toBe('Chưa phân nhóm')
    expect(groupItemsByKindAndCategory(items, categories, { hideInactive: false })[0])
      .toMatchObject({ itemCount: 7, lowStockCount: 3 })
  })

  it('dùng nhóm cũ khi chưa có bảng danh mục, kể cả khi còn ID cũ', () => {
    const result = groupItemsByKindAndCategory(items, [], { kind: 'reusable' })
    expect(result[0].groups.map(({ category }) => category.name)).toEqual([
      'Phụ kiện', 'hoa-LUA', 'Rèm vải', 'Chưa phân nhóm',
    ])
    expect(result[0]).toMatchObject({ itemCount: 6, lowStockCount: 2 })
  })

  it('tìm đủ vật tư và chuyển chế độ sắp xếp xuống từng nhóm', () => {
    const many = Array.from({ length: 64 }, (_, index) => ({
      id: index,
      name: 'Đèn',
      kind: 'reusable',
      category_id: 2,
      code: `TSD-${String(64 - index).padStart(3, '0')}`,
    }))
    const result = groupItemsByKindAndCategory(many, categories, { search: 'den', sortBy: 'code' })
    expect(result[0].itemCount).toBe(64)
    expect(result[0].groups[0].subgroups[0].items[0].id).toBe(63)
    expect(many[0].id).toBe(0)
  })
})

describe('ghép tên nhóm, tìm kiếm và loại lạ', () => {
  it('trùng tên gốc/con: ưu tiên nhóm gốc, chỉ mơ hồ khi >= 2 nhóm gốc', () => {
    const cats = [{ id: 1, name: 'Hoa' }, { id: 2, name: 'Hoa', parent_id: 1 }]
    const [section] = groupItemsByKindAndCategory([{ kind: 'reusable', category: 'hoa', name: 'X' }], cats)
    expect(section.groups).toHaveLength(1)
    expect(section.groups[0]).toMatchObject({ category: { id: 1 }, itemCount: 1, subgroups: [] })
    expect(section.groups[0].items).toHaveLength(1)

    const twoRoots = [{ id: 1, name: 'Hoa' }, { id: 2, name: 'HOA' }]
    const [ambiguous] = groupItemsByKindAndCategory([{ kind: 'reusable', category: 'hoa' }], twoRoots)
    expect(ambiguous.groups.map(({ category }) => category.name)).toEqual(['Chưa phân nhóm'])
  })

  it('nhóm ảo mang mã khác mã nhóm thật và xếp sau nhóm chuẩn', () => {
    const cats = [{ id: 1, name: 'Phụ kiện', code: 'HOA', sort_order: 50 }]
    const [section] = groupItemsByKindAndCategory([{ kind: 'reusable', category: 'Hoa' }], cats)
    expect(section.groups.map(({ category }) => category.name)).toEqual(['Hoa'])
    expect(section.groups[0].category).toMatchObject({ code: 'HOA2', sort_order: 100 })
    const all = groupItemsByKindAndCategory([{ kind: 'reusable', category: 'Hoa' }], cats, { hideEmpty: false })
    expect(all[0].groups.map(({ category }) => category.name)).toEqual(['Phụ kiện', 'Hoa', 'Chưa phân nhóm'])
  })

  it('gộp khoảng trắng liền nhau của chuỗi tìm', () => {
    const result = (search) => groupItemsByKindAndCategory(items, categories, { kind: 'reusable', search })
    expect(result('hoa    a')).toMatchObject([{ itemCount: 1 }])
    expect(result('  hoa \t a ')).toMatchObject([{ itemCount: 1 }])
  })

  it('vật tư kind null hoặc lạ vào mục "Chưa rõ loại" ở cuối và vẫn được đếm', () => {
    const mixed = [
      { kind: 'reusable', name: 'a' },
      { kind: null, name: 'b' },
      { kind: 'weird', name: 'c' },
      { name: 'd' },
      { kind: 'weird', name: 'e', active: false },
    ]
    const sections = groupItemsByKindAndCategory(mixed, [])
    expect(sections.map(({ kind, label, itemCount }) => [kind, label, itemCount])).toEqual([
      ['reusable', 'Tái sử dụng', 1],
      ['unknown', 'Chưa rõ loại', 3],
    ])
    expect(sections.reduce((total, { itemCount }) => total + itemCount, 0)).toBe(4)
    expect(groupItemsByKindAndCategory(mixed, [], { kind: 'reusable' })).toHaveLength(1)
    expect(groupItemsByKindAndCategory(mixed, [], { hideInactive: false }).at(-1).itemCount).toBe(4)
    expect(groupItemsByKindAndCategory([], [], { hideEmpty: false }).map(({ kind }) => kind))
      .toEqual(['reusable', 'consumable'])
  })
})

describe('sắp xếp vật tư và khóa mã', () => {
  it('sắp mã và tên theo số tự nhiên', () => {
    const codes = [{ code: 'TSD-10' }, { code: 'TSD-2' }, { code: 'TSD-1' }]
    expect(sortItems(codes, 'code').map(({ code }) => code)).toEqual(['TSD-1', 'TSD-2', 'TSD-10'])
    expect(sortItems([{ name: 'Đèn 10' }, { name: 'Đèn 2' }]).map(({ name }) => name)).toEqual(['Đèn 2', 'Đèn 10'])
  })

  const list = Object.freeze([
    { name: 'Vải', code: 'C', in_stock: 0, min_stock: 0, created_at: '001-invalid' },
    { name: 'Đèn', code: 'A', in_stock: 4, min_stock: 5, created_at: '2026-11-20' },
    { name: 'Áo', code: 'B', in_stock: 1, min_stock: 5, created_at: '2026-11-21' },
    { name: 'Áo', code: 'D', in_stock: 5, min_stock: 5 },
  ].map(Object.freeze))

  it('sắp tên và mã tiếng Việt, dùng mã để phân thứ tự khi trùng tên', () => {
    expect(sortItems(list).map(({ code }) => code)).toEqual(['B', 'D', 'A', 'C'])
    expect(sortItems(list, 'code').map(({ code }) => code)).toEqual(['A', 'B', 'C', 'D'])
    expect(list.map(({ code }) => code)).toEqual(['C', 'A', 'B', 'D'])
  })

  it('xếp cảnh báo trước rồi tồn tăng dần và xếp ngày không hợp lệ cuối', () => {
    expect(sortItems(list, 'lowStock').map(({ code }) => code)).toEqual(['B', 'A', 'C', 'D'])
    expect(sortItems(list, 'newest').map(({ code }) => code)).toEqual(['B', 'A', 'D', 'C'])
    expect(sortItems([
      { name: 'Đèn', created_at: '2026-11-25' },
      { name: 'Áo', created_at: '2026-11-25' },
    ], 'newest').map(({ name }) => name)).toEqual(['Áo', 'Đèn'])
  })

  it('chỉ khóa mã khi đã có biến động', () => {
    expect(isItemCodeLocked(items[0], 2)).toBe(true)
    expect(isItemCodeLocked(items[0], '1')).toBe(true)
    expect(isItemCodeLocked(items[0], 0)).toBe(false)
    expect(isItemCodeLocked(items[0], undefined)).toBe(false)
  })
})

describe('danh sách chọn danh mục', () => {
  it('xếp con sau cha ngưng (dòng tiêu đề disabled), nhóm mồ côi không có tiền tố', () => {
    expect(buildCategoryOptions(categories).map(({ value, label, disabled }) => [value, label, disabled])).toEqual([
      [1, 'Hoa & Lá', true], [3, '— Hoa giấy', undefined],
      [4, 'Phụ kiện', undefined], [5, '— Hoa giấy', undefined],
      [6, 'Nhóm mồ côi', undefined],
    ])
  })

  it('cha ngưng không còn con đang dùng thì không hiện; cha đang chọn thì chọn được', () => {
    const cats = [{ id: 1, name: 'Cha', active: false }, { id: 2, name: 'Con', parent_id: 1, active: false }]
    expect(buildCategoryOptions(cats)).toEqual([])
    expect(buildCategoryOptions(cats, 1).map(({ value, disabled }) => [value, disabled])).toEqual([[1, undefined]])
    expect(buildCategoryOptions(cats, 2).map(({ value, label, disabled }) => [value, label, disabled])).toEqual([
      [1, 'Cha', true], [2, '— Con', undefined],
    ])
    expect(buildCategoryOptions(cats, '2')[1].value).toBe(2)
  })

  it('giữ đúng mục đã chọn kể cả khi ngưng dùng', () => {
    const withSelectedChild = buildCategoryOptions(categories, '2')
    expect(withSelectedChild.find(({ value }) => value === 2)).toEqual({
      ...categories[4], value: 2, label: '— Hoa lụa',
    })
    const withSelectedParent = buildCategoryOptions(categories, 1)
    expect(withSelectedParent.map(({ value }) => value)).toEqual([1, 3, 4, 5, 6])
    expect(withSelectedParent.some(({ value }) => value === 2)).toBe(false)
  })
})
