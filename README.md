# Personal Assistant

Production-oriented conversational assistant with four constrained agents: General, Calendar, Email,
and Finance. The orchestrator owns intent classification, dependency planning, retries, checkpoints,
cost budgets, and failure handling.

## Local setup

1. Copy `.env.example` to `.env.local` and add provider credentials.
2. Run `npm run secrets:fill` to populate missing application-security values.
3. Install dependencies with `npm install`.
4. Apply `supabase/migrations/0001_foundation.sql` to the Supabase project.
5. Start with `npm run dev`.

The runtime does not support destructive agent tools. External content and user input are treated as
untrusted data, and every state-changing operation must pass through approval and idempotency checks.
