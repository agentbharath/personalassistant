import type { ReplyKind } from "@/lib/agents/reply-needed";

export const KIND_LABELS: Record<ReplyKind, { title: string; hint: string }> = {
  person: { title: "People writing to me", hint: "Friends, family and colleagues who wrote to you directly." },
  recruiter: { title: "Recruiters", hint: "Recruiters and hiring managers writing about a job." },
  business: { title: "Companies and offices", hint: "Appointments, accounts, claims, documents or payments you need to answer." },
  invitation: { title: "Invitations and RSVPs", hint: "Events, meetups and groups asking if you’re coming." },
};
