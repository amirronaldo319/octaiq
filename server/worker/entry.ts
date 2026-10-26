import { handleRequest, ingest, type Deps, type Env, type Kv } from './handler.ts'

/** Cloudflare Workers entry point. Only this file knows about the platform; everything else is plain TypeScript. */
interface KvNamespace extends Kv {}
interface WorkerEnv extends Env {
  MARKET: KvNamespace
}
interface ScheduledContext {
  waitUntil(p: Promise<unknown>): void
}

const deps = (env: WorkerEnv): Deps => ({ kv: env.MARKET, env, fetchImpl: fetch, now: () => new Date() })

export default {
  fetch: (req: Request, env: WorkerEnv): Promise<Response> => handleRequest(req, deps(env)),
  // The schedule fires often; `ingest` decides whether a provider call is actually due, so quota is spent only when useful.
  scheduled: (_event: unknown, env: WorkerEnv, ctx: ScheduledContext): void => {
    ctx.waitUntil(ingest(deps(env)))
  },
}
