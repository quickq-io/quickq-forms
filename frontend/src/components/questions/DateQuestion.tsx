import type { FormItem } from '../../types/form'
import { useFormStore } from '../../store/form_store'

interface Props {
  item: FormItem
}

export function DateQuestion({ item }: Props) {
  const answers = useFormStore(s => s.answers.get(item.linkId) ?? [])
  const setAnswer = useFormStore(s => s.setAnswer)
  const clearAnswer = useFormStore(s => s.clearAnswer)

  const isDateTime = item.type === 'datetime'
  const answerType = isDateTime ? 'datetime' : 'date'

  const current =
    answers[0]?.type === 'date' ? answers[0].value
    : answers[0]?.type === 'datetime' ? answers[0].value
    : ''

  // datetime-local inputs use 'T' separator; FHIR dateTime uses 'T' too
  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value
    if (!v) {
      clearAnswer(item.linkId)
    } else {
      setAnswer(item.linkId, [{ type: answerType, value: v }])
    }
  }

  return (
    <input
      id={item.linkId}
      type={isDateTime ? 'datetime-local' : 'date'}
      className="rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
      value={current}
      onChange={handleChange}
    />
  )
}
