import { createContext, useContext, useState, type ReactNode } from 'react'

interface NavigationState {
  page: string | null
  data?: any
}

interface NavigationContextType {
  currentPage: string | null
  pageData: any
  navigate: (page: string | null, data?: any) => void
}

const NavigationContext = createContext<NavigationContextType>({
  currentPage: null,
  pageData: undefined,
  navigate: () => {},
})

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<NavigationState>({ page: null })

  const navigate = (page: string | null, data?: any) => {
    setState({ page, data })
  }

  return (
    <NavigationContext.Provider value={{ currentPage: state.page, pageData: state.data, navigate }}>
      {children}
    </NavigationContext.Provider>
  )
}

export function useAppNavigate() {
  return useContext(NavigationContext)
}
