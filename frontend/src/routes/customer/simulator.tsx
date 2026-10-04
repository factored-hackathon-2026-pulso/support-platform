import { useSearchParams } from 'react-router'
import { CustomerSimulatorScreen, channelFromSlug, slugFromChannel } from '@/features/customer-chat'

/**
 * /cliente?canal= — customer simulator (dev/demo tool, outside the staff shell and without
 * staff auth): act as a seeded customer by chat, call or email (`canal` = chat | llamada |
 * correo; none = the channel picker) with the analyst Workspace open in another window.
 */
export default function CustomerSimulatorRoute() {
  const [searchParams, setSearchParams] = useSearchParams()
  return (
    <CustomerSimulatorScreen
      channel={channelFromSlug(searchParams.get('canal'))}
      onChannelChange={(channel) =>
        setSearchParams(channel ? { canal: slugFromChannel(channel) } : {}, { replace: true })
      }
    />
  )
}
