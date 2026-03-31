export type StepStatus = 'completed' | 'current' | 'running' | 'failed' | 'skipped' | 'pending';

export interface Step {
  label: string;
  status: StepStatus;
  sublabel?: string;
}

export interface StepProgressProps {
  steps: Step[];
  size?: 'sm' | 'lg';
  onStepClick?: (index: number) => void;
}

const DOT_CLASS: Record<StepStatus, string> = {
  completed: 'beast-step-dot-done',
  current: 'beast-step-dot-active',
  running: 'beast-step-dot-active',
  failed: 'beast-step-dot-failed',
  skipped: 'beast-step-dot-skipped',
  pending: 'beast-step-dot-pending',
};

const LABEL_CLASS: Record<StepStatus, string> = {
  completed: 'beast-step-label-done',
  current: 'beast-step-label-active',
  running: 'beast-step-label-active',
  failed: 'beast-step-label-failed',
  skipped: 'beast-step-label-skipped',
  pending: 'beast-step-label-pending',
};

export function StepProgress({ steps, size = 'sm', onStepClick }: StepProgressProps) {
  return (
    <div className="beast-steps">
      {steps.map((step, i) => {
        const isLast = i === steps.length - 1;
        const isClickable = onStepClick && step.status === 'completed';
        const lineActive = step.status === 'completed';

        return (
          <div key={step.label} className={`beast-step${isLast ? '' : ' beast-step-grow'}`}>
            <div
              className={`beast-step-node${isClickable ? ' beast-step-clickable' : ''}`}
              onClick={() => isClickable && onStepClick(i)}
            >
              <span
                data-testid="step-dot"
                className={`beast-step-dot ${DOT_CLASS[step.status]}${size === 'lg' ? ' beast-step-dot-lg' : ''}`}
              />
              <span className={`beast-step-label ${LABEL_CLASS[step.status]}`}>
                {step.label}
              </span>
              {step.sublabel && (
                <span className="beast-step-sublabel">{step.sublabel}</span>
              )}
            </div>
            {!isLast && (
              <div
                data-testid="step-line"
                className={`beast-step-line ${lineActive ? 'beast-step-line-done' : 'beast-step-line-pending'}`}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
