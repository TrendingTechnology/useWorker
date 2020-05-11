import React from 'react'
import createWorkerBlobUrl from './lib/createWorkerBlobUrl'
import WORKER_STATUS from './lib/status'
import { useDeepCallback } from './hook/useDeepCallback'

type WorkerController = {
  status: WORKER_STATUS;
  kill: Function;
}

type Options = {
  timeout?: number;
  remoteDependencies?: string[];
  autoTerminate?: boolean;
  transferList?: boolean;
}

const PROMISE_RESOLVE = 'resolve'
const PROMISE_REJECT = 'reject'
const DEFAULT_OPTIONS: Options = {
  timeout: undefined,
  remoteDependencies: [],
  autoTerminate: true,
  transferList: true,
}

/**
 *
 * @param {Function} fn the function to run with web worker
 * @param {Object} options useWorker option params
 */
export const useWorker = <T extends (...fnArgs: any[]) => any>(
  fn: T, options: Options = DEFAULT_OPTIONS,
) => {
  const [workerStatus, _setWorkerStatus] = React.useState<WORKER_STATUS>(WORKER_STATUS.PENDING)
  const worker = React.useRef<Worker & { _url?: string }>()
  const isRunning = React.useRef(false)
  const promise = React.useRef<{
    [PROMISE_REJECT]?:(result: ReturnType<T> | ErrorEvent) => void;[PROMISE_RESOLVE]?:
    (result: ReturnType<T>) => void
  }>({})
  const timeoutId = React.useRef<number>()

  const setWorkerStatus = React.useCallback((status: WORKER_STATUS) => {
    isRunning.current = status === WORKER_STATUS.RUNNING
    _setWorkerStatus(status)
  }, [])

  const killWorker = React.useCallback(() => {
    if (worker.current?._url) {
      worker.current.terminate()
      URL.revokeObjectURL(worker.current._url)
      promise.current = {}
      worker.current = undefined
      window.clearTimeout(timeoutId.current)
    }
  }, [])

  const onWorkerEnd = React.useCallback((status: WORKER_STATUS) => {
    const terminate = options.autoTerminate != null
      ? options.autoTerminate
      : DEFAULT_OPTIONS.autoTerminate

    if (terminate) {
      killWorker()
    }
    setWorkerStatus(status)
  }, [options.autoTerminate, killWorker, setWorkerStatus])

  const generateWorker = useDeepCallback(() => {
    const {
      remoteDependencies = DEFAULT_OPTIONS.remoteDependencies,
      timeout = DEFAULT_OPTIONS.timeout,
    } = options

    const blobUrl = createWorkerBlobUrl(fn, remoteDependencies!)
    const newWorker: Worker & { _url?: string } = new Worker(blobUrl)
    newWorker._url = blobUrl

    newWorker.onmessage = (e: MessageEvent) => {
      const [status, result] = e.data as [WORKER_STATUS, ReturnType<T>]

      switch (status) {
        case WORKER_STATUS.SUCCESS:
          promise.current[PROMISE_RESOLVE]?.(result)
          onWorkerEnd(WORKER_STATUS.SUCCESS)
          break
        default:
          promise.current[PROMISE_REJECT]?.(result)
          onWorkerEnd(WORKER_STATUS.ERROR)
          break
      }
    }

    newWorker.onerror = (e: ErrorEvent) => {
      promise.current[PROMISE_REJECT]?.(e)
      onWorkerEnd(WORKER_STATUS.ERROR)
    }

    if (timeout) {
      timeoutId.current = window.setTimeout(() => {
        killWorker()
        setWorkerStatus(WORKER_STATUS.TIMEOUT_EXPIRED)
      }, timeout)
    }
    return newWorker
  }, [fn, options, killWorker])

  const callWorker = React.useCallback((...fnArgs: Parameters<T>) => (
    new Promise<ReturnType<T>>((resolve, reject) => {
      promise.current = {
        [PROMISE_RESOLVE]: resolve,
        [PROMISE_REJECT]: reject,
      }

      const transferable: any = fnArgs.filter((x: any) => (
        (x instanceof ArrayBuffer) || (x instanceof MessagePort)
        // eslint-disable-next-line no-restricted-globals
        || (self.ImageBitmap && x instanceof ImageBitmap)
      ))

      worker.current?.postMessage([[...fnArgs]], transferable)

      setWorkerStatus(WORKER_STATUS.RUNNING)
    })
  ), [setWorkerStatus])

  const workerHook = React.useCallback((...fnArgs: Parameters<T>) => {
    const terminate = options.autoTerminate != null
      ? options.autoTerminate
      : DEFAULT_OPTIONS.autoTerminate

    if (isRunning.current) {
      /* eslint-disable-next-line no-console */
      console.error('[useWorker] You can only run one instance of the worker at a time, if you want to run more than one in parallel, create another instance with the hook useWorker(). Read more: https://github.com/alewin/useWorker')
      return Promise.reject()
    }
    if (terminate || !worker.current) {
      worker.current = generateWorker()
    }

    return callWorker(...fnArgs)
  }, [options.autoTerminate, generateWorker, callWorker])

  const workerController = {
    status: workerStatus,
    kill: killWorker,
  }

  React.useEffect(() => () => {
    killWorker()
  }, [killWorker])

  return [
    workerHook, workerController,
  ] as [typeof workerHook, WorkerController]
}
