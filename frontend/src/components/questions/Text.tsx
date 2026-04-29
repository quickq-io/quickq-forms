import { useFormStore } from '../../store/form_store'
import type { FormItem } from '../../types/form'

interface Props {
  item: FormItem
}

export function Text({ item }: Props) {
  const answers = useFormStore(s => s.answers.get(item.linkId) ?? [])
  const setAnswer = useFormStore(s => s.setAnswer)
  const clearAnswer = useFormStore(s => s.clearAnswer)

  const value = answers[0]?.type === 'string' ? answers[0].value : ''

  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const v = e.target.value
    if (v === '') {
      clearAnswer(item.linkId)
    } else {
      setAnswer(item.linkId, [{ type: 'string', value: v }])
    }
  }

  return (
    <textarea
      id={item.linkId}
      className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 resize-y min-h-[80px]"
      value={value}
      onChange={handleChange}
      placeholder="Enter your response…"
    />
  )
}
