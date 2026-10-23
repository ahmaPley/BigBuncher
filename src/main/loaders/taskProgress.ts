import type { Task } from '@xmcl/task'
import type { TaskReporter } from '../core/tasks'

/** Runs an @xmcl task tree and forwards its aggregated progress to a TaskReporter. */
export function runXmclTask<T>(task: Task<T>, report: TaskReporter, label: string): Promise<T> {
  return task.startAndWait({
    onUpdate(child) {
      // Forge/NeoForge processors run Java without byte progress; show an honest indeterminate state.
      if (/postProcess/i.test(child.path)) {
        report.update(-1, `${label}: сборка файлов игры (1–3 минуты)`)
        return
      }
      const progress = task.total > 0 ? task.progress / task.total : -1
      report.update(progress, `${label}: ${child.path.split('.').pop() ?? ''}`)
    }
  })
}
