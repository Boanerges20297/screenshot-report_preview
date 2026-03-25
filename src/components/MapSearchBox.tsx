import { useState, useEffect, useRef } from 'react'
import L from 'leaflet'
import { normalizeLookupName, type GeoFeatureCollection } from '../lib/snapshot'

type SearchResult = {
  type: 'polygon' | 'geo'
  label: string
  sublabel: string
  score?: number
  lat?: number
  lon?: number
  id?: string
}

type MapSearchBoxProps = {
  map: L.Map | null
  polygons: GeoFeatureCollection
  onSelectTerritory: (id: string) => void
}

export function MapSearchBox({ map, polygons, onSelectTerritory }: MapSearchBoxProps) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResult[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isSearching, setIsSearching] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const pinRef = useRef<L.Marker | null>(null)

  // Prevent map dragging when interacting with the search box
  useEffect(() => {
    if (containerRef.current) {
      L.DomEvent.disableClickPropagation(containerRef.current)
      L.DomEvent.disableScrollPropagation(containerRef.current)
    }
  }, [])

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([])
      setIsOpen(false)
      return
    }

    const timer = setTimeout(async () => {
      const qNorm = normalizeLookupName(query)
      const localResults: SearchResult[] = []

      // 1. Search local polygons
      polygons.features.forEach((feature) => {
        const name = normalizeLookupName(String(feature.properties?.name || ''))
        const cleanName = String(feature.properties?.clean_name || '')
        const region = String(feature.properties?.region_type || 'fortaleza')
        const id = `${region}:${cleanName}`

        if (name.includes(qNorm)) {
          localResults.push({
            type: 'polygon',
            label: String(feature.properties?.name || ''),
            sublabel: region,
            score: Number(feature.properties?.risk_score || feature.properties?.risk_score_cvli || 0),
            id: id,
          })
        }
      })

      localResults.sort((a, b) => {
        const aExact = normalizeLookupName(a.label) === qNorm ? 0 : 1
        const bExact = normalizeLookupName(b.label) === qNorm ? 0 : 1
        if (aExact !== bExact) return aExact - bExact
        return (b.score || 0) - (a.score || 0)
      })

      setResults(localResults)
      setIsOpen(true)
      setIsSearching(true)

      // 2. Search Nominatim (OpenStreetMap)
      try {
        const response = await fetch(`https://nominatim.openstreetmap.org/search?format=json&countrycodes=BR&q=${encodeURIComponent(query)}`)
        if (response.ok) {
          const data = await response.json()
          const geoResults: SearchResult[] = data
            .filter((g: any) => {
              // Avoid duplicates with local results naively
              const gName = normalizeLookupName(g.name.split(',')[0] || '')
              return !localResults.some((lr) => normalizeLookupName(lr.label).includes(gName))
            })
            .map((g: any) => ({
              type: 'geo',
              label: g.name.split(',')[0],
              sublabel: g.display_name,
              lat: parseFloat(g.lat),
              lon: parseFloat(g.lon),
            }))

          setResults((prev) => [...prev, ...geoResults])
        }
      } catch (err) {
        console.warn('Geocoding error:', err)
      } finally {
        setIsSearching(false)
      }
    }, 300)

    return () => clearTimeout(timer)
  }, [query, polygons])

  const handleSelect = (result: SearchResult) => {
    setIsOpen(false)
    setQuery('')
    
    if (result.type === 'polygon' && result.id) {
      onSelectTerritory(result.id)
    } else if (result.type === 'geo' && result.lat && result.lon && map) {
      // Fly to geo result and place a pin
      const latlng = new L.LatLng(result.lat, result.lon)
      map.flyTo(latlng, 15, { duration: 1.5 })

      if (pinRef.current) {
        map.removeLayer(pinRef.current)
      }

      const icon = L.divIcon({
        className: '',
        html: `<div style="width:14px;height:14px;background:#FFD700;border:2px solid white;border-radius:50%;box-shadow:0 0 8px rgba(255,215,0,0.8);"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7],
      })

      pinRef.current = L.marker(latlng, { icon }).addTo(map)
      pinRef.current.bindPopup(`
        <div style="font-family:system-ui,sans-serif;font-size:0.82rem;max-width:220px;word-break:break-word;">
          <strong style="color:#b45309;display:block;margin-bottom:2px;">${result.label}</strong>
          <span style="color:#64748b;font-size:0.75rem;">${result.sublabel}</span>
        </div>
      `).openPopup()
    }
  }

  return (
    <div className="map-search-container" ref={containerRef}>
      <div className="map-search-bar">
        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="map-search-icon">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        <input
          type="text"
          className="map-search-input"
          placeholder="Buscar rua, bairro ou localidade..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {query && (
          <button className="map-search-clear" onClick={() => setQuery('')}>
            &times;
          </button>
        )}
      </div>

      {isOpen && (
        <div className="map-search-results">
          {results.length > 0 ? (
            results.map((r, i) => (
              <div key={i} className="map-search-result-item" onClick={() => handleSelect(r)}>
                {r.type === 'polygon' ? (
                  <div className="search-icon-polygon" style={{ backgroundColor: r.score && r.score >= 51 ? '#fee2e2' : '#e0f2fe', color: r.score && r.score >= 51 ? '#dc2626' : '#0284c7' }}>
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z"/></svg>
                  </div>
                ) : (
                  <div className="search-icon-geo">
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>
                  </div>
                )}
                <div className="search-result-text">
                  <strong>{r.label}</strong>
                  <span>{r.sublabel}</span>
                </div>
                {r.type === 'polygon' && r.score !== undefined && (
                  <span className="search-result-score" style={{ color: r.score >= 51 ? '#dc2626' : '#64748b' }}>
                    {r.score.toFixed(0)}%
                  </span>
                )}
              </div>
            ))
          ) : (
            <div className="map-search-empty">
              {isSearching ? 'Buscando lugares...' : 'Nenhum resultado encontrado.'}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
