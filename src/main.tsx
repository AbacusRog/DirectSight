import { Component, StrictMode, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

// Show any unexpected crash on screen instead of a blank page.
class Boundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) {
    return { error }
  }
  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="p-6 max-w-xl mx-auto">
        <h1 className="text-lg font-semibold">Something went wrong</h1>
        <pre className="mt-2 text-sm text-red-700 whitespace-pre-wrap">{this.state.error.message}</pre>
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
