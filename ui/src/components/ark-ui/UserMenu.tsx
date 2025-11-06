import { Avatar } from '@ark-ui/solid/avatar'
import { Menu } from '@ark-ui/solid/menu'
import { Show } from 'solid-js'
import { useAuth } from '~/components/AuthProvider'

export const UserMenu = () => {
  const { user, signOut } = useAuth()

  const getInitials = (name: string | null, email: string | null) => {
    if (name) {
      return name
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    }
    if (email) {
      return email[0].toUpperCase()
    }
    return 'U'
  }

  const handleSignOut = async () => {
    await signOut()
  }

  return (
    <Show when={user()}>
      {(currentUser) => (
        <Menu.Root>
          <Menu.Trigger class="flex items-center gap-2 cursor-pointer hover:opacity-80 transition-opacity">
            <Avatar.Root class="w-8 h-8 rounded-full overflow-hidden border-2 border-white/20">
              <Avatar.Fallback class="bg-sky-700 text-white text-sm font-medium flex items-center justify-center w-full h-full">
                {getInitials(currentUser().displayName, currentUser().primaryEmail)}
              </Avatar.Fallback>
              <Show when={currentUser().profileImageUrl}>
                <Avatar.Image
                  src={currentUser().profileImageUrl!}
                  alt={currentUser().displayName || 'User avatar'}
                  class="w-full h-full object-cover"
                />
              </Show>
            </Avatar.Root>
            <span class="text-gray-200 text-sm font-medium hidden sm:block">
              {currentUser().displayName || currentUser().primaryEmail}
            </span>
          </Menu.Trigger>

          <Menu.Positioner>
            <Menu.Content class="bg-white rounded-lg shadow-lg border border-gray-200 min-w-48 py-2 z-50">
              <Menu.Item
                value="profile"
                class="px-4 py-2 text-gray-700 hover:bg-gray-100 cursor-pointer transition-colors"
              >
                <a href="/profile" class="block w-full">Profile Settings</a>
              </Menu.Item>

              <Menu.Separator class="my-2 border-t border-gray-200" />

              <Menu.Item
                value="logout"
                onClick={handleSignOut}
                class="px-4 py-2 text-red-600 hover:bg-red-50 cursor-pointer transition-colors"
              >
                Sign Out
              </Menu.Item>
            </Menu.Content>
          </Menu.Positioner>
        </Menu.Root>
      )}
    </Show>
  )
}
