import { adminGraphql } from "./_shared/graphql";
import {
  AppError,
  assertHasuraWebhook,
  sendError,
  type FunctionRequest,
  type FunctionResponse,
} from "./_shared/http";

type Notification = {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
};

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;")
    .replaceAll("\n", "<br />");
}

async function updateNotification(id: string, values: Record<string, unknown>): Promise<void> {
  await adminGraphql(`
    mutation UpdateNotification($id: uuid!, $values: notification_outbox_set_input!) {
      update_notification_outbox_by_pk(pk_columns: { id: $id }, _set: $values) { id }
    }
  `, { id, values });
}

export default async function handler(req: FunctionRequest, res: FunctionResponse) {
  let notification: Notification | undefined;
  try {
    assertHasuraWebhook(req);
    const body = req.body as { event?: { data?: { new?: Notification } } } | undefined;
    notification = body?.event?.data?.new;
    if (!notification) throw new AppError("Notification event payload is missing", "INVALID_EVENT");
    if (notification.status !== "pending") {
      res.status(200).json({ ignored: true });
      return;
    }

    const apiKey = process.env.RESEND_API_KEY;
    const from = process.env.RESEND_FROM_EMAIL;
    if (!apiKey || !from) throw new AppError("Resend environment is not configured", "CONFIGURATION", 500);

    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: [notification.recipient],
        subject: notification.subject,
        html: `<div style="font-family:Inter,Arial,sans-serif;line-height:1.6;color:#172033">${escapeHtml(notification.body)}</div>`,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const payload = await response.json() as { id?: string; message?: string };
    if (!response.ok || !payload.id) {
      throw new AppError(payload.message ?? `Resend returned ${response.status}`, "EMAIL_FAILED", 502);
    }

    await updateNotification(notification.id, {
      status: "sent",
      provider_id: payload.id,
      sent_at: new Date().toISOString(),
      error: null,
    });
    res.status(200).json({ id: notification.id, providerId: payload.id });
  } catch (error) {
    if (notification?.id) {
      await updateNotification(notification.id, {
        status: "failed",
        error: error instanceof Error ? error.message : "Email delivery failed",
      }).catch(() => undefined);
    }
    sendError(res, error);
  }
}

