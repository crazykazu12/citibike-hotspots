import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet'
import 'leaflet/dist/leaflet.css'
import type { Station } from './types'

interface MapProps {
  stations: Station[]
}

export function Map({ stations }: MapProps) {
  return (
    <MapContainer
      center={[40.74, -73.99]}
      zoom={12}
      style={{ height: '100vh', width: '100vw' }}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {stations.map((s) => (
        <CircleMarker
          key={s.station_id}
          center={[s.lat, s.lon]}
          radius={5}
          pathOptions={{ color: '#1976d2', weight: 1, fillOpacity: 0.7 }}
        >
          <Popup>
            <strong>{s.name}</strong>
            <br />
            Bikes: {s.num_bikes_available}
            <br />
            Docks: {s.num_docks_available}
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  )
}
