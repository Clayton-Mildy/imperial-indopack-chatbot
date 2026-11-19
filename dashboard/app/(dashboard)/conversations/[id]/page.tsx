import { getConversation, getContactProfile } from "@/lib/api/conversations";
import { Header } from "@/components/layout/Header";
import { ConversationDetailClient } from "./ConversationDetailClient";
import { notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { getAiDefault } from "@/actions/settingsActions";
import type { ContactProfile } from "@/types/api";

export default async function ConversationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const t = await getT();

  const [session, conversationResult] = await Promise.allSettled([
    auth(),
    getConversation(id).catch((err: unknown) => {
      const status = (err as { status?: number }).status;
      if (status === 404 || status === 501) {
        notFound();
      }
      console.warn("[conversation-detail] Fetch error:", err);
      return null;
    }),
  ]);

  const conversation =
    conversationResult.status === "fulfilled" ? conversationResult.value : null;

  if (!conversation) {
    notFound();
  }

  const agentName =
    session.status === "fulfilled" && session.value?.user?.name
      ? session.value.user.name
      : "Agen";

  const contactName =
    conversation.contact?.displayName ??
    conversation.contact?.waId ??
    t("conversations.title");

  let contactProfile: ContactProfile | null = null;
  try {
    const profileResult = await getContactProfile(id);
    contactProfile = profileResult;
  } catch {
    // no profile yet — that's fine
  }

  // Needed to show the contact's *effective* AI state when it has no override.
  const aiDefault = await getAiDefault();

  return (
    <>
      <Header title={contactName} breadcrumb={t("conversations.title")} breadcrumbHref="/conversations" />
      <ConversationDetailClient
        conversation={conversation}
        agentName={agentName}
        contactProfile={contactProfile}
        aiDefault={aiDefault}
      />
    </>
  );
}
