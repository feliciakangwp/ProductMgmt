import type { VersionStatus } from '@productflow/domain';
import { Badge } from '../../components/ui';

const LABELS: Record<VersionStatus, { label: string; tone: 'amber' | 'green' | 'slate' }> = {
  draft: { label: 'Draft', tone: 'amber' },
  approved: { label: 'Approved', tone: 'green' },
  superseded: { label: 'Superseded', tone: 'slate' },
};

export function VersionStatusBadge({ status }: { status: VersionStatus }) {
  const { label, tone } = LABELS[status];
  return <Badge tone={tone}>{label}</Badge>;
}
