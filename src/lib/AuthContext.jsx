import { createContext, useContext, useEffect, useState, useCallback } from 'react'
import { supabase, isSupabaseConfigured } from './supabase'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(isSupabaseConfigured)
  const [authError, setAuthError] = useState('')
  const [profileError, setProfileError] = useState(false)
  const [isPasswordRecovery, setIsPasswordRecovery] = useState(false)

  const fetchProfile = useCallback(async (user) => {
    if (!supabase || !user) {
      setProfile(null)
      setLoading(false)
      return
    }
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .maybeSingle()

      if (error) {
        // Lỗi mạng/DB: KHÔNG đặt pending. Giữ profile cũ (nếu cùng người dùng).
        setAuthError(error.message)
        setProfileError(true)
        setProfile((prev) => (prev && prev.id === user.id ? prev : null))
      } else {
        setAuthError('')
        setProfileError(false)
        if (data) {
          setProfile(data)
        } else {
          // Truy vấn thành công nhưng chưa có dòng: mới thực sự là chờ duyệt.
          setProfile({
            id: user.id,
            email: user.email,
            full_name: user.user_metadata?.full_name || user.email?.split('@')[0] || '',
            role: 'pending',
          })
        }
      }
    } catch (err) {
      setAuthError(err.message || 'Lỗi tải thông tin tài khoản')
      setProfileError(true)
      setProfile((prev) => (prev && prev.id === user.id ? prev : null))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!isSupabaseConfigured || !supabase) {
      setLoading(false)
      return
    }

    supabase.auth
      .getSession()
      .then(({ data: { session: s } }) => {
        setSession(s)
        if (s?.user) {
          fetchProfile(s.user)
        } else {
          setLoading(false)
        }
      })
      .catch((err) => {
        setAuthError(err?.message || 'Lỗi tải phiên đăng nhập')
        setLoading(false)
      })

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') {
        setIsPasswordRecovery(true)
      }
      setSession(s)
      if (s?.user) {
        fetchProfile(s.user)
      } else {
        setProfile(null)
        setProfileError(false)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [fetchProfile])

  const signIn = async (email, password) => {
    setAuthError('')
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })
    if (error) throw error
    return data
  }

  const signUp = async (email, password, fullName) => {
    setAuthError('')
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: fullName },
      },
    })
    if (error) throw error
    return data
  }

  const resetPassword = async (email) => {
    setAuthError('')
    const { data, error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    })
    if (error) throw error
    return data
  }

  const updatePassword = async (newPassword) => {
    setAuthError('')
    const { data, error } = await supabase.auth.updateUser({
      password: newPassword,
    })
    if (error) throw error
    setIsPasswordRecovery(false)
    return data
  }

  const signOut = async () => {
    if (!supabase) return
    try {
      await supabase.auth.signOut({ scope: 'local' })
    } catch (err) {
      console.error('signOut lỗi:', err)
    } finally {
      setSession(null)
      setProfile(null)
      setProfileError(false)
      setAuthError('')
    }
  }

  const refreshProfile = async () => {
    if (session?.user) {
      await fetchProfile(session.user)
    }
  }

  const role = profile?.role || 'pending'
  const isAdmin = role === 'admin'
  const isManagerOrAdmin = role === 'admin' || role === 'manager'
  const canEditCatalog = role === 'admin' || role === 'manager' || role === 'storekeeper'
  const canDeleteCatalog = role === 'admin' || role === 'manager'
  const isStorekeeper = role === 'storekeeper'
  const isStaff = role === 'staff'
  const isPending = role === 'pending'

  return (
    <AuthContext.Provider
      value={{
        session,
        user: session?.user || null,
        profile,
        role,
        loading,
        authError,
        profileError,
        isAdmin,
        isManagerOrAdmin,
        canEditCatalog,
        canDeleteCatalog,
        isStorekeeper,
        isStaff,
        isPending,
        signIn,
        signUp,
        resetPassword,
        updatePassword,
        isPasswordRecovery,
        setIsPasswordRecovery,
        signOut,
        refreshProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
