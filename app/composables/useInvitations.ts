export interface InvitationAlbum {
  id: number
  title: string | null
  description: string | null
  created_at: string
  admin: { id: number, first_name: string, last_name: string }
  cover: string | null
  email: string
  has_pending_account: boolean
}

// Public Invitation-token lookup (issue #52), backing the Invitation
// screen: unlike useAlbums' fetchAlbum, this hits a route that doesn't
// require auth, since the whole point of the Invitation screen is to be
// reachable by someone who doesn't have an account yet.
export function useInvitations() {
  async function fetchInvitation(token: string) {
    const requestFetch = import.meta.server ? useRequestFetch() : $fetch
    return await requestFetch<InvitationAlbum>(`/api/invitations/${token}`)
  }

  return { fetchInvitation }
}
