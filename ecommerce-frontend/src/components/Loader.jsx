// Small reusable spinner. `full` centres it in the page for route-level loads.
export default function Loader({ label = 'Loading...', full = false }) {
  return (
    <div className={full ? 'loader loader-full' : 'loader'} role="status" aria-live="polite">
      <span className="spinner" aria-hidden="true" />
      <span className="loader-label">{label}</span>
    </div>
  )
}

// Grey placeholder blocks, used while product grids load.
export function Skeleton({ count = 8 }) {
  return (
    <div className="grid">
      {Array.from({ length: count }).map((_, i) => (
        <div className="skeleton-card" key={i}>
          <div className="skeleton skeleton-img" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line short" />
        </div>
      ))}
    </div>
  )
}
