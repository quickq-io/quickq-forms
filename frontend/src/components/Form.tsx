import { useEffect, useState } from 'react'
import { useFormStore } from '../store/form_store'
import { parseQuestionnaire } from '../engine/fhir_parser'
import { serializeResponse } from '../engine/fhir_serializer'
import { Question } from './Question'
import type { Questionnaire } from '../types/fhir'

export function Form() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)

  const model = useFormStore(s => s.model)
  const setModel = useFormStore(s => s.setModel)
  const answers = useFormStore(s => s.answers)
  const enabled = useFormStore(s => s.enabled)
  const groupInstances = useFormStore(s => s.groupInstances)

  useEffect(() => {
    fetch('/questionnaire')
      .then(r => {
        if (!r.ok) throw new Error(`Server returned ${r.status}`)
        return r.json() as Promise<Questionnaire>
      })
      .then(q => {
        setModel(parseQuestionnaire(q))
        setLoading(false)
      })
      .catch(e => {
        setError(String(e))
        setLoading(false)
      })
  }, [setModel])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!model) return
    const response = serializeResponse(model, { answers, enabled, groupInstances })
    const res = await fetch('/response', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(response),
    })
    if (res.ok) {
      setSubmitted(true)
    } else {
      setError(`Submission failed: ${res.status}`)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <p className="text-gray-500 text-sm">Loading questionnaire…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="rounded-lg border border-red-200 bg-red-50 px-6 py-4 text-sm text-red-700">
          {error}
        </div>
      </div>
    )
  }

  if (submitted) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-center">
          <p className="text-xl font-semibold text-gray-900">Thank you.</p>
          <p className="mt-2 text-sm text-gray-500">Your response has been submitted.</p>
        </div>
      </div>
    )
  }

  if (!model) return null

  return (
    <div className="min-h-screen bg-gray-50 py-10">
      <div className="mx-auto max-w-2xl px-4">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold text-gray-900">{model.title}</h1>
        </header>

        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-8">
          {model.items.map(item => (
            <Question key={item.linkId} item={item} />
          ))}

          <div className="pt-4 border-t border-gray-200">
            <button
              type="submit"
              className="w-full rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-colors"
            >
              Submit
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
