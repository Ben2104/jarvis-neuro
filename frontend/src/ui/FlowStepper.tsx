const STEPS = ['Upload MRI', 'Segment & review', 'Explore in 3D']

/** Pill stepper shared by the Upload and Processing screens; `active` is 0-based. */
export function FlowStepper({ active }: { active: number }) {
  return (
    <ol className="flow-stepper" aria-label="Progress">
      {STEPS.map((label, i) => (
        <li key={label} className={i < active ? 'done' : i === active ? 'active' : ''} aria-current={i === active ? 'step' : undefined}>
          <span className="idx">{i < active ? '✓' : i + 1}</span>
          {label}
        </li>
      ))}
    </ol>
  )
}
