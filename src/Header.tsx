// Title-only header. The Compare dropdown, view-mode toggle, and last-updated
// indicator live in `src/Drawer.tsx` and are accessed via the slide-out tab
// on the left edge of the map.
//
// The bottom-edge cool→hot color band is rendered via a CSS pseudo-element
// (.app-header::after in src/index.css) — no DOM nodes here.
export function Header() {
  return (
    <header className="app-header">
      <h1 className="app-title">
        Where in the <span className="app-title-accent">Citi</span>?
      </h1>
    </header>
  )
}
