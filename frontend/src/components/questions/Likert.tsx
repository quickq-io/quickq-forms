import type { FormItem } from '../../types/form'
import { useFormStore } from '../../store/form_store'

interface Props {
  item: FormItem
}

// Horizontal scale — same data model as SingleChoice but rendered as a row.
export function Likert({ item }: Props) {
  const answers = useFormStore(s => s.answers.get(item.linkId) ?? [])
  const setAnswer = useFormStore(s => s.setAnswer)
  const clearAnswer = useFormStore(s => s.clearAnswer)

  const current = answers[0]?.type === 'coding' ? answers[0].coding.code : null
  const options = item.options ?? []

  function handleChange(code: string) {
    if (current === code) {
      clearAnswer(item.linkId)
    } else {
      const opt = options.find(o => o.code === code)
      setAnswer(item.linkId, [
        { type: 'coding', coding: { code, display: opt?.display, system: opt?.system } },
      ])
    }
  }

  return (
    <fieldset>
      <legend className="sr-only">{item.text}</legend>
      <div className="flex gap-2 flex-wrap">
        {options.map(opt => {
          const checked = current === opt.code
            return (
            <label
              key={opt.code}
              className={`flex flex-col items-center gap-1 cursor-pointer min-w-[60px] flex-1 px-2 py-3 rounded-lg border text-center transition-colors ${
                checked
                  ? 'border-blue-600 bg-blue-50 text-blue-700 font-medium'
                  : 'border-gray-200 bg-white text-gray-600 hover:border-gray-400'
              }`}
            >
              <input
                type="radio"
                className="sr-only"
                name={item.linkId}
                checked={checked}
                onChange={() => handleChange(opt.code)}
              />
              <span
                className={`h-4 w-4 shrink-0 rounded-full border-2 flex items-center justify-center ${
                  checked ? 'border-blue-600' : 'border-gray-400'
                }`}
              >
                {checked && <span className="h-2 w-2 rounded-full bg-blue-600" />}
              </span>
              <span className="text-xs leading-tight">{opt.display}</span>
            </label>
          )
        })}
      </div>
      {options.length > 0 && (
        <div className="flex justify-between mt-1 px-1">
          <span className="text-xs text-gray-400">{options[0].display}</span>
          <span className="text-xs text-gray-400">{options[options.length - 1].display}</span>
        </div>
      )}
    </fieldset>
  )
}
