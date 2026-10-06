import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { setAgentAvatar } from '../api'
import { AgentPhotoSlot } from './AgentPhotoSlot'

vi.mock('@/features/automation/api')

beforeEach(() => vi.mocked(setAgentAvatar).mockReset().mockResolvedValue(undefined))

test('the empty slot opens the avatar choices and picking one saves it', async () => {
  const user = userEvent.setup()
  renderWithProviders(<AgentPhotoSlot type="undue_charge" avatar={null} />)
  expect(screen.getByText('Foto del agente')).toBeInTheDocument()

  await user.click(screen.getByRole('button', { name: 'Elegir la foto del agente' }))
  await user.click(screen.getByRole('button', { name: 'Estrella' }))

  expect(vi.mocked(setAgentAvatar)).toHaveBeenCalledWith('undue_charge', 'star')
})
