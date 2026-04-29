import type { FormItem } from '../../types/form'
import { useFormStore } from '../../store/form_store'

interface Props {
  item: FormItem
}

export function Slider({ item }: Props) {
  const answers = useFormStore(s => s.answers.get(item.linkId) ?? [])
  const setAnswer = useFormStore(s => s.setAnswer)

  const cfg = item.sliderConfig!
  const current =
    answers[0]?.type === 'integer' ? answers[0].value
    : answers[0]?.type === 'decimal' ? answers[0].value
    : null

  // Show the midpoint as initial display value — but only set an answer on interaction
  const displayValue = current ?? Math.round((cfg.min + cfg.max) / 2)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const n = parseInt(e.target.value, 10)
    setAnswer(item.linkId, [{ type: 'integer', value: n }])
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-4">
        <input
          id={item.linkId}
          type="range"
          min={cfg.min}
          max={cfg.max}
          step={cfg.step ?? 1}
          value={displayValue}
          onChange={handleChange}
          className="flex-1 h-2 rounded-lg appearance-none cursor-pointer accent-blue-600"
        />
        <span className="w-10 text-right text-sm font-medium text-gray-900 tabular-nums">
          {current !== null ? current : <span className="text-gray-400">—</span>}
        </span>
      </div>
      {(cfg.minLabel || cfg.maxLabel) && (
        <div className="flex justify-between text-xs text-gray-400 px-1">
          <span>{cfg.minLabel ?? cfg.min}</span>
          <span>{cfg.maxLabel ?? cfg.max}</span>
        </div>
      )}
    </div>
  )
}
