export type DigestChange = {
  label: string | null;
  url: string;
  summary: string;
};

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function summaryToBullets(summary: string): string[] {
  return summary
    .split("\n")
    .map((line) => line.replace(/^[\s•\-*]+/, "").trim())
    .filter(Boolean);
}

export function getDigestSubject(changeCount: number): string {
  const noun = changeCount === 1 ? "change" : "changes";
  return `${changeCount} competitor ${noun} detected today`;
}

function renderChangeBlock(change: DigestChange): string {
  const title = escapeHtml(change.label ?? change.url);
  const url = escapeHtml(change.url);
  const bullets = summaryToBullets(change.summary)
    .map((bullet) => `<li style="margin:0 0 8px;color:#3f3f46;">${escapeHtml(bullet)}</li>`)
    .join("");

  return `
    <div style="margin-bottom:24px;padding-bottom:24px;border-bottom:1px solid #e4e4e7;">
      <p style="margin:0 0 4px;font-size:16px;font-weight:600;color:#18181b;">${title}</p>
      <a href="${url}" style="font-size:13px;color:#71717a;text-decoration:none;">${url}</a>
      <ul style="margin:12px 0 0;padding-left:20px;font-size:14px;line-height:1.5;">
        ${bullets}
      </ul>
    </div>
  `;
}

export function renderDigestEmail(
  changes: DigestChange[],
  dashboardUrl: string
): string {
  const changeBlocks = changes.map(renderChangeBlock).join("");
  const safeDashboardUrl = escapeHtml(dashboardUrl);

  return `
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Competitor changes</title>
  </head>
  <body style="margin:0;padding:0;background-color:#fafafa;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color:#fafafa;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background-color:#ffffff;border:1px solid #e4e4e7;border-radius:12px;">
            <tr>
              <td style="padding:32px 32px 24px;">
                <p style="margin:0 0 8px;font-size:13px;font-weight:500;color:#71717a;letter-spacing:0.02em;text-transform:uppercase;">Daily digest</p>
                <h1 style="margin:0;font-size:22px;font-weight:600;color:#18181b;line-height:1.3;">
                  ${changes.length} competitor ${changes.length === 1 ? "change" : "changes"} detected
                </h1>
                <p style="margin:12px 0 0;font-size:14px;line-height:1.5;color:#52525b;">
                  Here's what changed on the pages you're tracking.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:0 32px 8px;">
                ${changeBlocks}
              </td>
            </tr>
            <tr>
              <td style="padding:8px 32px 32px;" align="center">
                <a href="${safeDashboardUrl}" style="display:inline-block;background-color:#18181b;color:#ffffff;font-size:14px;font-weight:500;text-decoration:none;padding:12px 24px;border-radius:8px;">
                  View on Dashboard
                </a>
              </td>
            </tr>
          </table>
          <p style="margin:24px 0 0;font-size:12px;color:#a1a1aa;">
            You're receiving this because you track competitor pages.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>
  `.trim();
}
