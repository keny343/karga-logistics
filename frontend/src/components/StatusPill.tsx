import './StatusPill.css';

/**
 * Delivery states grouped by what an operator does about them. Colour alone must
 * never carry the meaning, so the label is always present next to it.
 */
export type StatusGroup = 'pending' | 'moving' | 'done' | 'failed' | 'idle';

interface Props {
  readonly label: string;
  readonly group: StatusGroup;
}

export const StatusPill = ({ label, group }: Props) => (
  <span className="status-pill" data-group={group}>
    <span className="status-pill__dot" aria-hidden="true" />
    {label}
  </span>
);
