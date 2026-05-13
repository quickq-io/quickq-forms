// Assigns display numbers to numberable items in display order.
//
// Rules:
//   - Concrete answerable types get a number (single_choice, boolean, …, grid, repeating_group)
//   - `section` and `instruction` items don't get numbers (they're headers, not questions)
//   - Section children get numbers and continue the parent counter
//   - Repeating-group children DO NOT get independent numbers — the parent
//     is the one "question," each instance is just another fill of it
//
// The result is a Map<linkId, number> built once at parse time and looked up
// by Question via NumberingContext.

import type { FormItem, FormModel } from '../types/form'

export function buildNumbering(model: FormModel): Map<string, number> {
  const map = new Map<string, number>()
  let counter = 0

  function walk(items: FormItem[]) {
    for (const item of items) {
      if (item.type === 'section') {
        walk(item.children ?? [])
        continue
      }
      if (item.type === 'instruction') continue
      counter += 1
      map.set(item.linkId, counter)
      // Repeating-group and grid children are not independently numbered.
    }
  }

  walk(model.items)
  return map
}
