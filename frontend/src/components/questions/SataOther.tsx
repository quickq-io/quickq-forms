import { useState } from 'react'
import type { FormItem } from '../../types/form'
import { useFormStore } from '../../store/form_store'

interface Props {
  item: FormItem
}

// open-choice: coded checkboxes + a free-text "other" input.
// Coded selections are stored as coding answers; free text as a string answer.
export function SataOther({ item }: Props) {
  const answers = useFormStore(s => s.answers.get(item.linkId) ?? [])
  const setAnswer = useFormStore(s => s.setAnswer)

  const [otherText, setOtherText] = useState(() => {
    const str = answers.find(a => a.type === 'string')
    return str?.type === 'string' ? str.value : ''
  })

  const selectedCodes = new Set(
    answers.flatMap(a => (a.type === 'coding' && a.coding.code ? [a.coding.code] : []))
  )

  function syncAnswers(codes: Set<string>, text: string) {
    const next = [
      ...[...codes].map(code => {
        const opt = item.options?.find(o => o.code === code)
        return { type: 'coding' as const, coding: { code, display: opt?.display, system: opt?.system } }
      }),
      ...(text.trim() ? [{ type: 'string' as const, value: text.trim() }] : []),
    ]
    setAnswer(item.linkId, next)
  }

  function toggleCode(code: string) {
    const next = new Set(selectedCodes)
    if (next.has(code)) next.delete(code)
    else next.add(code)
    syncAnswers(next, otherText)
  }

  function handleOtherChange(e: React.ChangeEvent<HTMLInputElement>) {
    const text = e.target.value
    setOtherText(text)
    syncAnswers(selectedCodes, text)
  }

  return (
    <fieldset>
      <legend className="sr-only">{item.text}</legend>
      <div className="flex flex-col gap-2">
        {(item.options ?? []).map(opt => {
          const checked = selectedCodes.has(opt.code)
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
                onChange={() => toggleCode(opt.code)}
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

        <div className="mt-1">
          <input
            type="text"
            placeholder="Other (please specify)…"
            value={otherText}
            onChange={handleOtherChange}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
      </div>
    </fieldset>
  )
}
