import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'
import { installPrintGuard } from './lib/theme'

installPrintGuard()

// Show any unexpected crash on screen instead of a blank page.
class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="mx-auto max-w-xl p-6">
        <h1 className="text-lg">Something went wrong</h1>
        <pre className="mt-2 whitespace-pre-wrap text-sm text-bad">{this.state.error.message}</pre>
      </div>
    )
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Boundary>
      <App />
    </Boundary>
  </StrictMode>,
)
