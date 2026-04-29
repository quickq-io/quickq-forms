import type { FormItem } from '../../types/form'
import { useFormStore } from '../../store/form_store'

interface Props {
  item: FormItem
}

export function MultipleChoice({ item }: Props) {
  const answers = useFormStore(s => s.answers.get(item.linkId) ?? [])
  const setAnswer = useFormStore(s => s.setAnswer)

  const selected = new Set(
    answers.flatMap(a => (a.type === 'coding' && a.coding.code ? [a.coding.code] : []))
  )

  function toggle(code: string) {
    const opt = item.options?.find(o => o.code === code)
    if (selected.has(code)) {
      const next = answers.filter(a => !(a.type === 'coding' && a.coding.code === code))
      setAnswer(item.linkId, next)
    } else {
      setAnswer(item.linkId, [
        ...answers,
        { type: 'coding', coding: { code, display: opt?.display, system: opt?.system } },
      ])
    }
  }

  return (
    <fieldset>
      <legend className="sr-only">{item.text}</legend>
      <div className="flex flex-col gap-2">
        {(item.options ?? []).map(opt => {
          const checked = selected.has(opt.code)
          return (
            <label
              key={opt.code}
              className={`flex items-center gap-3 cursor-pointer rounded-lg border px-4 py-3 transition-colors ${
                checked
                  ? 'border-blue-600 bg-blue-50 text-blue-700 font-medium'
                  : 'border-gray-200 bg-white text-gray-700 hover:border-gray-400'
              }`}
            >
              <input
                type="checkbox"
                className="sr-only"
                checked={checked}
                onChange={() => toggle(opt.code)}
              />
              <span
                className={`h-4 w-4 shrink-0 rounded border-2 flex items-center justify-center ${
                  checked ? 'border-blue-600 bg-blue-600' : 'border-gray-400 bg-white'
                }`}
              >
                {checked && (
                  <svg className="w-2.5 h-2.5 text-white" viewBox="0 0 10 8" fill="none">
                    <path d="M1 4l3 3 5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              {opt.display}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
