import { useCallback, useState } from 'react'

/**
 * State that can be controlled (`value` + `onChange`) or uncontrolled (`defaultValue`).
 * Shared by Tabs, SegmentedControl, Accordion and Dialog.
 */
export function useControllableState<T>(
  value: T | undefined,
  defaultValue: T,
  onChange?: (next: T) => void,
): [T, (next: T) => void] {
  const [internal, setInternal] = useState<T>(defaultValue)
  const isControlled = value !== undefined
  const current = isControlled ? value : internal

  const setValue = useCallback(
    (next: T) => {
      if (!isControlled) setInternal(next)
      onChange?.(next)
    },
    [isControlled, onChange],
  )

  return [current, setValue]
}
