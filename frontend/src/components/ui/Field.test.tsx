import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Checkbox } from './Checkbox'
import { Field } from './Field'
import { Input } from './Input'
import { Select } from './Select'

describe('Field', () => {
  it('labels the control and wires hint and error', () => {
    render(
      <Field label="Contraseña" hint="Mínimo 12 caracteres" error="No coincide">
        <Input type="password" />
      </Field>,
    )
    const input = screen.getByLabelText('Contraseña')
    expect(input).toHaveAttribute('aria-invalid', 'true')
    expect(input).toHaveAccessibleDescription('No coincide Mínimo 12 caracteres')
  })

  it('works with Select', () => {
    render(
      <Field label="Seguimiento">
        <Select
          defaultValue="tomorrow"
          options={[
            { value: 'tomorrow', label: 'Mañana' },
            { value: 'none', label: 'Sin seguimiento' },
          ]}
        />
      </Field>,
    )
    expect(screen.getByRole('combobox', { name: 'Seguimiento' })).toHaveValue('tomorrow')
  })

  it('works with Checkbox: Field label, hint and error reach the input', () => {
    render(
      <Field label="Roles" hint="Puedes combinar roles" error="Elige al menos uno">
        <Checkbox label="Supervisora" description="Aprueba y audita" />
      </Field>,
    )
    const checkbox = screen.getByRole('checkbox')
    expect(checkbox).toHaveAccessibleName(/Roles/)
    expect(checkbox).toHaveAttribute('aria-invalid', 'true')
    expect(checkbox).toHaveAccessibleDescription(
      'Aprueba y audita Elige al menos uno Puedes combinar roles',
    )
  })
})
