import { useSearchParams } from 'react-router'
import {
  CustomerSimulatorScreen,
  parseSimulatorChannel,
  toSimulatorSearch,
} from '@/features/customer-chat'

/**
 * /customer?channel= — customer simulator (dev/demo tool, outside the staff shell and without
 * staff auth): act as a seeded customer by chat, call or email (`channel` = chat | call |
 * email; none = the channel picker) with the analyst Workspace open in another window.
 */
export default function CustomerSimulatorRoute() {
  const [searchParams, setSearchParams] = useSearchParams()
  return (
    <CustomerSimulatorScreen
      channel={parseSimulatorChannel(searchParams)}
      onChannelChange={(channel) => setSearchParams(toSimulatorSearch(channel), { replace: true })}
    />
  )
}
