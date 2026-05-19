import { Badge } from '@/components/ui/badge'
import { indentStageColor, indentStageLabel } from '@/lib/utils'

export function IndentStagePill({ stage }: { stage: string }) {
  return <Badge variant={indentStageColor(stage)}>{indentStageLabel(stage)}</Badge>
}
