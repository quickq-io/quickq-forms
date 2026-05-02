import type { FormItem, AnswerValue } from '../../types/form'
import { useFormStore } from '../../store/form_store'

const EMPTY: AnswerValue[] = []

interface Props {
  item: FormItem
}

export function Numeric({ item }: Props) {
  const answers = useFormStore(s => s.answers.get(item.linkId) ?? EMPTY)
  const setAnswer = useFormStore(s => s.setAnswer)
  const clearAnswer = useFormStore(s => s.clearAnswer)

  const cfg = item.numericConfig
  const isInteger = cfg?.isInteger ?? false

  const current =
    answers[0]?.type === 'decimal' ? answers[0].value
    : answers[0]?.type === 'integer' ? answers[0].value
    : ''

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value
    if (raw === '') {
      clearAnswer(item.linkId)
      return
    }
    const n = isInteger ? parseInt(raw, 10) : parseFloat(raw)
    if (isNaN(n)) return
    setAnswer(item.linkId, [{ type: isInteger ? 'integer' : 'decimal', value: n }])
  }

  return (
    <input
      id={item.linkId}
      type="number"
      className="w-full max-w-xs rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      value={current}
      onChange={handleChange}
      min={cfg?.min}
      max={cfg?.max}
      step={cfg?.step ?? (isInteger ? 1 : 'any')}
      placeholder={
        cfg?.min !== undefined && cfg?.max !== undefined
          ? `${cfg.min}–${cfg.max}`
          : undefined
      }
    />
  )
}
