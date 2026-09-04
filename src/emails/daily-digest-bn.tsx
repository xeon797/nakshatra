import React from 'react';
import { DailyDigestEmailProps, EmailStoryItem } from './daily-digest';
import { toBengaliDigits } from '../lib/i18n';

function escapeHtml(str: string): string {
  if (!str) return '';
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

const BENGALI_CATEGORY_LABELS: Record<string, string> = {
  llm_release: 'মডেল ও এলএলএম',
  agentic: 'স্বায়ত্তশাসিত এজেন্ট',
  infra: 'এআই ইনফ্রাস্ট্রাকচার',
  research: 'গবেষণাপত্র',
  policy: 'নীতিমালা ও নিরাপত্তা',
};

export function renderDailyDigestBnHtml(props: DailyDigestEmailProps): string {
  const siteUrl = props.siteUrl || 'https://nakshatra.ai';
  const unsubscribeUrl = props.unsubscribeUrl || `${siteUrl}/newsletter/unsubscribe`;

  const topStory = props.topStory;
  const topStoryTitle = topStory ? (topStory.titleBn || topStory.title) : '';
  const topStoryDeck = topStory ? (topStory.summaryBn || topStory.deck) : '';

  const topStoryHtml = topStory
    ? `
    <!-- Top Story / Breaking (Bengali) -->
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #0f172a; border: 1px solid #1e293b; border-radius: 12px; margin-bottom: 28px; overflow: hidden;">
      <tr>
        <td style="padding: 24px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
            <tr>
              <td>
                <span style="display: inline-block; background-color: #0369a1; color: #e0f2fe; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; padding: 4px 10px; border-radius: 9999px; margin-bottom: 12px; font-family: 'Hind Siliguri', 'Noto Sans Bengali', sans-serif;">
                  আজকের প্রধান খবর &bull; ব্রেকিং
                </span>
              </td>
            </tr>
            <tr>
              <td>
                <h2 style="margin: 0 0 12px 0; color: #ffffff; font-size: 22px; font-weight: 800; line-height: 1.4; font-family: 'Hind Siliguri', 'Noto Sans Bengali', sans-serif;">
                  <a href="${siteUrl}/article/${topStory.slug}" style="color: #ffffff; text-decoration: none;">
                    ${escapeHtml(topStoryTitle)}
                  </a>
                </h2>
              </td>
            </tr>
            <tr>
              <td>
                <p style="margin: 0 0 16px 0; color: #94a3b8; font-size: 14px; line-height: 1.75; font-family: 'Hind Siliguri', 'Noto Sans Bengali', sans-serif;">
                  ${escapeHtml(topStoryDeck)}
                </p>
              </td>
            </tr>
            <tr>
              <td>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                  <tr>
                    <td style="vertical-align: middle;">
                      <span style="color: #38bdf8; font-size: 12px; font-weight: 600; font-family: 'Hind Siliguri', 'Noto Sans Bengali', sans-serif;">
                        উৎস: ${escapeHtml(topStory.sourceNames.join(' + ') || 'শীর্ষ ল্যাব')}
                      </span>
                    </td>
                    <td align="right" style="vertical-align: middle;">
                      <a href="${siteUrl}/article/${topStory.slug}" style="display: inline-block; background-color: #0284c7; color: #ffffff; font-size: 13px; font-weight: 600; text-decoration: none; padding: 8px 16px; border-radius: 6px; font-family: 'Hind Siliguri', 'Noto Sans Bengali', sans-serif;">
                        উৎস ও প্রমাণ যাচাই &rarr;
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
      const bnCategoryLabel = BENGALI_CATEGORY_LABELS[cat.category] || cat.categoryLabel;

      const storyCards = cat.stories
        .map((s) => {
          const sTitle = s.titleBn || s.title;
          const sDeck = s.summaryBn || s.deck;

          return `
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #090d16; border: 1px solid #1e293b; border-radius: 8px; margin-bottom: 12px;">
          <tr>
            <td style="padding: 16px;">
              <h4 style="margin: 0 0 6px 0; font-size: 16px; font-weight: 700; line-height: 1.4; font-family: 'Hind Siliguri', 'Noto Sans Bengali', sans-serif;">
                <a href="${siteUrl}/article/${s.slug}" style="color: #f1f5f9; text-decoration: none;">
                  ${escapeHtml(sTitle)}
                </a>
              </h4>
              <p style="margin: 0 0 8px 0; color: #94a3b8; font-size: 13px; line-height: 1.75; font-family: 'Hind Siliguri', 'Noto Sans Bengali', sans-serif;">
                ${escapeHtml(sDeck)}
              </p>
              <span style="color: #38bdf8; font-size: 11px; font-weight: 500; font-family: 'Hind Siliguri', 'Noto Sans Bengali', sans-serif;">
                ${escapeHtml(s.sourceNames.join(', ') || 'প্রাথমিক উৎস')}
              </span>
            </td>
          </tr>
        </table>
      `;
        })
        .join('');

      return `
      <div style="margin-bottom: 24px;">
        <h3 style="margin: 0 0 12px 0; color: #38bdf8; font-size: 15px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.05em; border-bottom: 1px solid #1e293b; padding-bottom: 6px; font-family: 'Hind Siliguri', 'Noto Sans Bengali', sans-serif;">
          ${escapeHtml(bnCategoryLabel)}
        </h3>
        ${storyCards}
      </div>
    `;
    })
    .join('');

  const quickHitsHtml =
    props.quickHits.length > 0
      ? `
    <!-- Quick Hits (Bengali) -->
    <div style="background-color: #0f172a; border: 1px solid #1e293b; border-radius: 12px; padding: 20px; margin-bottom: 28px;">
      <h3 style="margin: 0 0 12px 0; color: #e2e8f0; font-size: 16px; font-weight: 700; font-family: 'Hind Siliguri', 'Noto Sans Bengali', sans-serif;">
        ⚡ দ্রুত এআই গোয়েন্দা তথ্য ও সংক্ষিপ্ত খবর
      </h3>
      <ul style="margin: 0; padding-left: 20px; color: #cbd5e1; font-size: 13px; line-height: 1.85; font-family: 'Hind Siliguri', 'Noto Sans Bengali', sans-serif;">
        ${props.quickHits
          .map((q) => {
            const qTitle = q.titleBn || q.title;
            return `
          <li style="margin-bottom: 6px;">
            <a href="${siteUrl}/article/${q.slug}" style="color: #38bdf8; text-decoration: none; font-weight: 600;">
              ${escapeHtml(qTitle)}
            </a>
            ${q.sourceNames.length > 0 ? `<span style="color: #64748b;"> &mdash; ${escapeHtml(q.sourceNames[0])}</span>` : ''}
          </li>
        `;
          })
          .join('')}
      </ul>
    </div>
    `
      : '';

  return `
<!DOCTYPE html>
<html lang="bn">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>নক্ষত্র দৈনিক এআই ব্রিফিং</title>
</head>
<body style="margin: 0; padding: 0; background-color: #030712; font-family: 'Hind Siliguri', 'Noto Sans Bengali', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc; line-height: 1.75;">
  <center style="width: 100%; background-color: #030712;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; margin: 0 auto; padding: 20px;">
      <!-- Header -->
      <tr>
        <td style="padding: 24px 0 20px 0; border-bottom: 2px solid #1e293b; text-align: center;">
          <h1 style="margin: 0; font-size: 28px; font-weight: 900; letter-spacing: 0.05em; color: #38bdf8; font-family: 'Hind Siliguri', 'Noto Sans Bengali', sans-serif;">
            নক্ষত্র (NAKSHATRA)
          </h1>
          <p style="margin: 4px 0 0 0; font-size: 13px; letter-spacing: 0.05em; color: #94a3b8; font-weight: 600; font-family: 'Hind Siliguri', 'Noto Sans Bengali', sans-serif;">
            স্বায়ত্তশাসিত এআই ইন্টেলিজেন্স &bull; দৈনিক সংস্করণ
          </p>
        </td>
      </tr>

      <!-- Subheader Statement -->
      <tr>
        <td style="padding: 16px 0; text-align: center;">
          <p style="margin: 0; font-size: 13px; color: #64748b; font-family: 'Hind Siliguri', 'Noto Sans Bengali', sans-serif;">
            শূন্য-বিভ্রান্তি, শতভাগ তথ্যপ্রমাণ ভিত্তিক স্বায়ত্তশাসিত প্রতিবেদন
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
        <td style="padding: 28px 0; border-top: 1px solid #1e293b; text-align: center; color: #64748b; font-size: 12px; line-height: 1.75; font-family: 'Hind Siliguri', 'Noto Sans Bengali', sans-serif;">
          <p style="margin: 0 0 8px 0;">
            এই ব্রিফিংয়ের প্রতিটি বক্তব্য সরাসরি যাচাইকৃত প্রাথমিক ল্যাব নথির সাথে সংযুক্ত।
          </p>
          <p style="margin: 0 0 8px 0;">
            &copy; ২০২৬ নক্ষত্র (NAKSHATRA) কর্তৃক স্বয়ংক্রিয়ভাবে প্রকাশিত &bull; সর্বস্বত্ব সংরক্ষিত।
          </p>
          <p style="margin: 0;">
            <a href="${unsubscribeUrl}" style="color: #94a3b8; text-decoration: underline;">
              আনসাবস্ক্রাইব করুন
            </a>
            &bull;
            <a href="${siteUrl}" style="color: #94a3b8; text-decoration: underline;">
              মূল ওয়েব ফিড দেখুন
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

/**
 * React Email component representation for Bengali
 */
export const DailyDigestBnEmail: React.FC<DailyDigestEmailProps> = (props) => {
  const html = renderDailyDigestBnHtml(props);
  return <div dangerouslySetInnerHTML={{ __html: html }} />;
};

export default DailyDigestBnEmail;
