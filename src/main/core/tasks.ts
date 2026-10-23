import { randomUUID } from 'node:crypto'
import type { TaskState } from '../../shared/types'
import { emit } from './events'

export interface TaskReporter {
  /** progress: 0..1, or -1 when unknown. */
  update(progress: number, detail?: string): void
}

const tasks = new Map<string, TaskState>()

/**
 * Runs a long operation as a visible task: the UI receives `task` events with
 * progress and the final status. Errors are re-thrown to the caller.
 */
export async function runTask<T>(
  title: string,
  work: (report: TaskReporter) => Promise<T>,
  instanceId?: string
): Promise<T> {
  const state: TaskState = { id: randomUUID(), title, instanceId, progress: -1, status: 'running' }
  tasks.set(state.id, state)
  emit('task', state)

  let lastEmit = 0
  const reporter: TaskReporter = {
    update(progress, detail) {
      state.progress = progress
      if (detail !== undefined) state.detail = detail
      const now = Date.now()
      if (now - lastEmit > 120) {
        lastEmit = now
        emit('task', { ...state })
      }
    }
  }

  try {
    const result = await work(reporter)
    Object.assign(state, { status: 'done', progress: 1 })
    return result
  } catch (err) {
    Object.assign(state, { status: 'error', error: describeError(err) })
    throw err
  } finally {
    emit('task', { ...state })
    setTimeout(() => tasks.delete(state.id), 30_000)
  }
}

export function listTasks(): TaskState[] {
  return [...tasks.values()]
}

export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message
  if (typeof err === 'object' && err && 'error' in err) return String((err as { error: unknown }).error)
  return String(err)
}
