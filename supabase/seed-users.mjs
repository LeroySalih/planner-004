// supabase/seed-users.js (ESM)
import 'dotenv/config'
import { createClient } from '@supabase/supabase-js'

const url =
  process.env.SUPABASE_URL ||
  process.env.NEXT_PUBLIC_SUPABASE_URL ||
  process.env.PUBLIC_SUPABASE_URL ||
  'http://127.0.0.1:54321'

const anonKey =
  process.env.SUPABASE_ANON_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  process.env.PUBLIC_SUPABASE_PUBLISHABLE_KEY

if (!anonKey) {
  console.error('Missing anon key. Set SUPABASE_ANON_KEY (or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY).')
  process.exit(1)
}

const client = createClient(url, anonKey, {
  auth: { autoRefreshToken: false, persistSession: false }
})

async function createUserWithProfile({ email, password, userMetadata = {}, profile }) {
  if (!profile) throw new Error('Profile payload is required')

  const { data: signUp, error: signUpErr } = await client.auth.signUp({
    email,
    password,
    options: { data: userMetadata }
  })
  if (signUpErr) throw signUpErr

  const userId = signUp.user?.id
  if (!userId) throw new Error('Sign-up returned no user id (is email confirmation required?)')

  const { error: profErr } = await client
    .from('profiles')
    .insert({ ...profile, user_id: userId })

  if (profErr) throw profErr

  return signUp.user
}

async function addUserToAllGroups(userId, role = 'teacher') {
  const [{ data: groups, error: groupsErr }, { data: existing, error: existingErr }] =
    await Promise.all([
      client.from('groups').select('group_id'),
      client.from('group_membership').select('group_id').eq('user_id', userId)
    ])

  if (groupsErr) throw groupsErr
  if (existingErr) throw existingErr

  if (!groups?.length) {
    console.warn('No groups found when trying to add user to group membership')
    return
  }

  const existingIds = new Set(existing?.map(({ group_id }) => group_id) ?? [])
  const payload = groups
    .filter(({ group_id }) => !existingIds.has(group_id))
    .map(({ group_id }) => ({
      group_id,
      user_id: userId,
      role
    }))

  if (!payload.length) {
    console.log('User already assigned to all groups')
    return
  }

  const { error: membershipErr } = await client.from('group_membership').insert(payload)
  if (membershipErr) throw membershipErr
}

async function main() {
  const user = await createUserWithProfile({
    email: 'tt@bisak.org',
    password: 'password',
    userMetadata: { role: 'teacher' },
    profile: {
      first_name: 'Test',
      last_name: 'Teacher',
      is_teacher: true
    }
  })

  if (user?.id) {
    await addUserToAllGroups(user.id, 'teacher')
  }

  console.log('Seed complete for user:', user?.id)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
