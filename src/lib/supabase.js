import { createClient } from '@supabase/supabase-js'

const DEFAULT_SUPABASE_URL = 'https://kdcendxxipxstlxuhnwh.supabase.co'
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_0GJolCoGzUmNbO8MAwC3YQ_IclKm0bt'

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL).trim()
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || DEFAULT_SUPABASE_ANON_KEY).trim()

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
    supabaseAnonKey &&
    supabaseUrl.startsWith('http')
)

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null
