import type { FormItem, AnswerValue } from '../../types/form'
import { useFormStore } from '../../store/form_store'

const EMPTY: AnswerValue[] = []

interface Props {
  item: FormItem
}

export function SingleChoice({ item }: Props) {
  const answers = useFormStore(s => s.answers.get(item.linkId) ?? EMPTY)
  const setAnswer = useFormStore(s => s.setAnswer)
  const clearAnswer = useFormStore(s => s.clearAnswer)

  const current =
    answers[0]?.type === 'coding' ? answers[0].coding.code : null

  function handleChange(code: string) {
    if (current === code) {
      clearAnswer(item.linkId)
    } else {
      const opt = item.options?.find(o => o.code === code)
      setAnswer(item.linkId, [
        { type: 'coding', coding: { code, display: opt?.display, system: opt?.system } },
      ])
    }
  }

  return (
    <fieldset>
      <legend className="sr-only">{item.text}</legend>
      <div className="flex flex-col gap-2">
        {(item.options ?? []).map(opt => {
          const checked = current === opt.code
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
                {checked && (
                  <span className="h-2 w-2 rounded-full bg-blue-600" />
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
