import React from 'react';

export interface EmailStoryItem {
  id: string;
  title: string;
  slug: string;
  deck: string;
  category: string;
  sourceNames: string[];
  readingTimeMinutes?: number;
  importanceScore?: number;
}

export interface DailyDigestEmailProps {
  dateStr: string;
  topStory?: EmailStoryItem;
  categoryHighlights: Array<{
    category: string;
    categoryLabel: string;
    stories: EmailStoryItem[];
  }>;
  quickHits: EmailStoryItem[];
  siteUrl?: string;
  unsubscribeUrl?: string;
}

/**
 * Generates an email-client compatible HTML string with inline CSS and responsive table layout
 */
export function renderDailyDigestHtml(props: DailyDigestEmailProps): string {
  const siteUrl = props.siteUrl || 'https://nakshatra.ai';
  const unsubscribeUrl = props.unsubscribeUrl || `${siteUrl}/newsletter/unsubscribe`;

  const topStoryHtml = props.topStory
    ? `
    <!-- Top Story / Breaking -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #0f172a; border: 1px solid #1e293b; border-radius: 12px; margin-bottom: 28px; overflow: hidden;">
      <tr>
        <td style="padding: 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <span style="display: inline-block; background-color: #0369a1; color: #e0f2fe; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 4px 10px; border-radius: 9999px; margin-bottom: 12px;">
                  TOP STORY OF THE DAY
                </span>
              </td>
            </tr>
            <tr>
              <td>
                <h2 style="margin: 0 0 12px 0; color: #ffffff; font-size: 22px; font-weight: 800; line-height: 1.3;">
                  <a href="${siteUrl}/article/${props.topStory.slug}" style="color: #ffffff; text-decoration: none;">
                    ${escapeHtml(props.topStory.title)}
                  </a>
                </h2>
              </td>
            </tr>
            <tr>
              <td>
                <p style="margin: 0 0 16px 0; color: #94a3b8; font-size: 14px; line-height: 1.6;">
                  ${escapeHtml(props.topStory.deck)}
                </p>
              </td>
            </tr>
            <tr>
              <td>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="vertical-align: middle;">
                      <span style="color: #38bdf8; font-size: 12px; font-weight: 600;">
                        Sources: ${escapeHtml(props.topStory.sourceNames.join(' + ') || 'Primary Labs')}
                      </span>
                    </td>
                    <td align="right" style="vertical-align: middle;">
                      <a href="${siteUrl}/article/${props.topStory.slug}" style="display: inline-block; background-color: #0284c7; color: #ffffff; font-size: 13px; font-weight: 600; text-decoration: none; padding: 8px 16px; border-radius: 6px;">
                        Read & Verify &rarr;
                      </a>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
    `
    : '';

  const categorySectionsHtml = props.categoryHighlights
    .map((cat) => {
      const storyCards = cat.stories
        .map(
          (s) => `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #090d16; border: 1px solid #1e293b; border-radius: 8px; margin-bottom: 12px;">
          <tr>
            <td style="padding: 16px;">
              <h4 style="margin: 0 0 6px 0; font-size: 16px; font-weight: 700;">
                <a href="${siteUrl}/article/${s.slug}" style="color: #f1f5f9; text-decoration: none;">
                  ${escapeHtml(s.title)}
                </a>
              </h4>
              <p style="margin: 0 0 8px 0; color: #94a3b8; font-size: 13px; line-height: 1.5;">
                ${escapeHtml(s.deck)}
              </p>
              <span style="color: #38bdf8; font-size: 11px; font-weight: 500;">
                ${escapeHtml(s.sourceNames.join(', ') || 'Primary Source')}
              </span>
            </td>
          </tr>
        </table>
      `
        )
        .join('');

      return `
      <div style="margin-bottom: 24px;">
        <h3 style="margin: 0 0 12px 0; color: #38bdf8; font-size: 15px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #1e293b; padding-bottom: 6px;">
          ${escapeHtml(cat.categoryLabel)}
        </h3>
        ${storyCards}
      </div>
    `;
    })
    .join('');

  const quickHitsHtml =
    props.quickHits.length > 0
      ? `
    <!-- Quick Hits -->
    <div style="background-color: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 28px;">
      <h3 style="margin: 0 0 12px 0; color: #e2e8f0; font-size: 16px; font-weight: 700;">
        ⚡ Fast Intelligence & Quick Hits
      </h3>
      <ul style="margin: 0; padding-left: 20px; color: #cbd5e1; font-size: 13px; line-height: 1.8;">
        ${props.quickHits
          .map(
            (q) => `
          <li style="margin-bottom: 6px;">
            <a href="${siteUrl}/article/${q.slug}" style="color: #38bdf8; text-decoration: none; font-weight: 600;">
              ${escapeHtml(q.title)}
            </a>
            ${q.sourceNames.length > 0 ? `<span style="color: #64748b;"> &mdash; ${escapeHtml(q.sourceNames[0])}</span>` : ''}
          </li>
        `
          )
          .join('')}
      </ul>
    </div>
    `
      : '';

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>NAKSHATRA Daily AI Digest</title>
</head>
<body style="margin: 0; padding: 0; background-color: #030712; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
  <center style="width: 100%; background-color: #030712;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; padding: 20px;">
      <!-- Header -->
      <tr>
        <td style="padding: 24px 0 20px 0; border-bottom: 2px solid #1e293b; text-align: center;">
          <h1 style="margin: 0; font-size: 28px; font-weight: 900; letter-spacing: 0.1em; color: #38bdf8; font-family: monospace;">
            NAKSHATRA
          </h1>
          <p style="margin: 4px 0 0 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.15em; color: #94a3b8; font-weight: 600;">
            Autonomous AI Intelligence &bull; ${escapeHtml(props.dateStr)}
          </p>
        </td>
      </tr>

      <!-- Subheader Statement -->
      <tr>
        <td style="padding: 16px 0; text-align: center;">
          <p style="margin: 0; font-size: 13px; color: #64748b;">
            Zero-Hallucination, 100% Evidence-Grounded Autonomous Reporting
          </p>
        </td>
      </tr>

      <!-- Content -->
      <tr>
        <td>
          ${topStoryHtml}
          ${categorySectionsHtml}
          ${quickHitsHtml}
        </td>
      </tr>

      <!-- Footer -->
      <tr>
        <td style="padding: 28px 0; border-top: 1px solid #1e293b; text-align: center; color: #64748b; font-size: 12px; line-height: 1.6;">
          <p style="margin: 0 0 8px 0;">
            Every statement in this briefing is automatically bound to verified primary documentation.
          </p>
          <p style="margin: 0 0 8px 0;">
            &copy; 2026 NAKSHATRA. All rights reserved.
          </p>
          <p style="margin: 0;">
            <a href="${unsubscribeUrl}" style="color: #94a3b8; text-decoration: underline;">
              Unsubscribe
            </a>
            &bull;
            <a href="${siteUrl}" style="color: #94a3b8; text-decoration: underline;">
              Visit Web Feed
            </a>
          </p>
        </td>
      </tr>
    </table>
  </center>
</body>
</html>
  `.trim();
}

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * React Email component representation
 */
export const DailyDigestEmail: React.FC<DailyDigestEmailProps> = (props) => {
  const html = renderDailyDigestHtml(props);
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
};

export default DailyDigestEmail;
