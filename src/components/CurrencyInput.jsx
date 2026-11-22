import { formatPriceDots, parsePriceInput } from '../lib/formatters'

export default function CurrencyInput({
  value,
  onChange,
  placeholder = 'VD: 250.000',
  required = false,
  disabled = false,
  className = '',
}) {
  const displayValue =
    value === '' || value === null || value === undefined
      ? ''
      : Number(value) === 0 && String(value) === ''
        ? ''
        : formatPriceDots(value)

  const handleChange = (e) => {
    const raw = e.target.value
    const cleaned = raw.replace(/[^\d]/g, '')
    if (!cleaned) {
      onChange(0)
      return
    }
    onChange(parsePriceInput(cleaned))
  }

  return (
    <input
      type="text"
      inputMode="numeric"
      required={required}
      disabled={disabled}
      placeholder={placeholder}
      className={className}
      value={displayValue}
      onChange={handleChange}
    />
  )
}
