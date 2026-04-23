import { useEffect, useState } from 'react'
import { fetchStations } from './gbfs'
import { Map } from './Map'
import type { Station } from './types'

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; stations: Station[] }

function App() {
  const [state, setState] = useState<State>({ status: 'loading' })

  useEffect(() => {
    fetchStations()
      .then((stations) => setState({ status: 'ready', stations }))
      .catch((err: unknown) =>
        setState({
          status: 'error',
          message: err instanceof Error ? err.message : String(err),
        }),
      )
  }, [])

  if (state.status === 'loading') return <p>Loading stations…</p>
  if (state.status === 'error') return <p>Error loading stations: {state.message}</p>
  return <Map stations={state.stations} />
}

export default App
