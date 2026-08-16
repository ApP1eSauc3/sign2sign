import { JobType } from '../../data/SignJob';
import { colors } from '../../utils/colors';
import { Pill } from './Pill';

interface TypePillProps {
  jobType: JobType;
}

export function TypePill({ jobType }: TypePillProps) {
  const color = jobType === 'install' ? colors.install : colors.removal;
  return <Pill variant="outline" label={jobType.toUpperCase()} color={color} />;
}
