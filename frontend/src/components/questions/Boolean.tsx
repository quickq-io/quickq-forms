import type { FormItem } from '../../types/form'
import { useFormStore } from '../../store/form_store'

interface Props {
  item: FormItem
}

export function Boolean({ item }: Props) {
  const answers = useFormStore(s => s.answers.get(item.linkId) ?? [])
  const setAnswer = useFormStore(s => s.setAnswer)
  const clearAnswer = useFormStore(s => s.clearAnswer)

  const current = answers[0]?.type === 'boolean' ? answers[0].value : null

  function handleChange(value: boolean) {
    if (current === value) {
      clearAnswer(item.linkId)
    } else {
      setAnswer(item.linkId, [{ type: 'boolean', value }])
    }
  }

  return (
    <fieldset>
      <legend className="sr-only">{item.text}</legend>
      <div className="flex gap-6">
        {(['Yes', 'No'] as const).map(label => {
          const val = label === 'Yes'
          const checked = current === val
          return (
            <label
              key={label}
              className={`flex items-center gap-2 cursor-pointer rounded-lg border px-4 py-2 transition-colors ${
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
                onChange={() => handleChange(val)}
              />
              {label}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}
