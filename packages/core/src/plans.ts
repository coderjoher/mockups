// SC-3: plans, monthly usage counters and billing webhooks.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getPool, one, query } from './db';

export const PLANS = {
  internal: { projectsPerMonth: Infinity, pagesPerMonth: Infinity },
  free: { projectsPerMonth: 3, pagesPerMonth: 30 },
  pro: { projectsPerMonth: 50, pagesPerMonth: 1000 },
  agency: { projectsPerMonth: 500, pagesPerMonth: 10_000 },
} as const;
export type Plan = keyof typeof PLANS;

export class PlanLimitError extends Error {
  statusCode = 402;
  code = 'plan_limit';
}

const month = (d = new Date()) => d.toISOString().slice(0, 7);

/** Adds to this month's usage, or throws if the plan's limit would be passed. Atomic per workspace. */
export async function useQuota(workspaceId: string, kind: 'projects' | 'pages', amount: number): Promise<void> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const { rows: [ws] } = await client.query('SELECT plan, usage FROM workspaces WHERE id = $1 FOR UPDATE', [workspaceId]);
    if (!ws) throw new Error('workspace not found');
    const plan = PLANS[(ws.plan as Plan) in PLANS ? (ws.plan as Plan) : 'free'];
    const usage = ws.usage?.month === month() ? ws.usage : { month: month(), projects: 0, pages: 0 };
    const limit = kind === 'projects' ? plan.projectsPerMonth : plan.pagesPerMonth;
    if ((usage[kind] ?? 0) + amount > limit) {
      throw new PlanLimitError(`Your ${ws.plan} plan allows ${limit} ${kind} a month. Upgrade to add more.`);
    }
    usage[kind] = (usage[kind] ?? 0) + amount;
    await client.query('UPDATE workspaces SET usage = $2 WHERE id = $1', [workspaceId, JSON.stringify(usage)]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function billingSummary(workspaceId: string) {
  const ws = await one('SELECT plan, usage FROM workspaces WHERE id = $1', [workspaceId]);
  const plan = (ws?.plan ?? 'free') as Plan;
  const usage = ws?.usage?.month === month() ? ws.usage : { month: month(), projects: 0, pages: 0 };
  const limits = PLANS[plan] ?? PLANS.free;
  const fmt = (n: number) => (Number.isFinite(n) ? n : null);
  return { plan, usage, limits: { projectsPerMonth: fmt(limits.projectsPerMonth), pagesPerMonth: fmt(limits.pagesPerMonth) } };
}

export function signWebhook(body: string, secret = process.env.BILLING_WEBHOOK_SECRET ?? ''): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

/** Provider-neutral webhook: {id, type: "subscription.updated" | "subscription.cancelled", workspace_id, plan}. Idempotent by event id. */
export async function handleBillingWebhook(raw: string, signature: string | undefined): Promise<{ duplicate: boolean }> {
  const secret = process.env.BILLING_WEBHOOK_SECRET;
  if (!secret) throw Object.assign(new Error('Billing is not configured'), { statusCode: 503, code: 'billing_disabled' });
  const expected = Buffer.from(signWebhook(raw, secret));
  const got = Buffer.from(signature ?? '');
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) throw Object.assign(new Error('Bad signature'), { statusCode: 401, code: 'bad_signature' });
  const event = JSON.parse(raw);
  if (!event?.id || !event?.type || !event?.workspace_id) throw Object.assign(new Error('Malformed event'), { statusCode: 400 });
  const inserted = await query('INSERT INTO billing_events(id, workspace_id, type, payload) VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING RETURNING id', [
    event.id, event.workspace_id, event.type, raw,
  ]);
  if (!inserted.length) return { duplicate: true };
  if (event.type === 'subscription.updated' && event.plan in PLANS && event.plan !== 'internal') {
    await query('UPDATE workspaces SET plan = $2 WHERE id = $1', [event.workspace_id, event.plan]);
  } else if (event.type === 'subscription.cancelled') {
    await query("UPDATE workspaces SET plan = 'free' WHERE id = $1", [event.workspace_id]);
  }
  return { duplicate: false };
}
