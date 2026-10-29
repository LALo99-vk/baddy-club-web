import { CircleDot } from 'lucide-react';
import type { PoolMatchStatus } from '@/data/tournament';

const LABEL: Record<PoolMatchStatus, string> = { upcoming: 'Upcoming', live: 'Live', completed: 'Completed', cancelled: 'Cancelled', noshow: 'No show' };

export function StatusPill({ status }: { status: PoolMatchStatus }) {
  return <span className={`status status-${status}`}>{status === 'live' && <CircleDot size={11} />}{LABEL[status]}</span>;
}
