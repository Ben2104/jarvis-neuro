export function Footer() {
  return (
    <footer className="app-footer">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--muted)" strokeWidth="2" aria-hidden="true">
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v6M12 16.5v.5" />
      </svg>
      <span>Educational visualization — not for diagnosis or surgical planning.</span>
      <span className="muted">
        Data: Medical Segmentation Decathlon, Task01_BrainTumour (derived from BraTS), CC BY-SA 4.0
      </span>
    </footer>
  )
}
