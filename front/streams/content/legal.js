/**
 * Legal / policy copy for the in-app Privacy Policy, Terms of Service and
 * Community Guidelines screens (rendered by pages/LegalPage.js).
 *
 * Kept out of components/ and pages/ so the long-form prose lives in one place
 * (and outside the hardcoded-string i18n guard, which scans only those dirs).
 *
 * ⚠️ These are good-faith STARTER templates that reflect how the app actually
 * works — they are NOT a substitute for legal review. Fill the [BRACKETED]
 * placeholders and have counsel review before relying on them.
 */

// ── Fill these in ────────────────────────────────────────────────────────────
export const LEGAL = {
  entity: 'Adventist Life',            // legal entity / operator name
  jurisdiction: '[your country/state]', // governing law + courts
  effectiveDate: '[effective date]',    // e.g. "1 August 2026"
  contactEmail: 'ankomark76@gmail.com',
};

const P = (updated, intro, sections) => ({ updated, intro, sections });

export const PRIVACY = P(
  `Last updated: ${LEGAL.effectiveDate}`,
  `This Privacy Policy explains what information ${LEGAL.entity} ("we", "us") collects when you use the app, how we use it, and the choices you have. By using the app you agree to this policy.`,
  [
    { h: 'Information you provide', p: [
      'Account details: your username, email address, and a securely hashed password.',
      'Profile information you choose to add, such as a display name, picture and bio.',
      'Content you create: posts, photos, videos, captions, comments, messages, choir/church/group activity, and marketplace listings.',
      'Payments: marketplace purchases are processed by Stripe. We do not see or store your full card details — Stripe handles them under its own privacy policy.',
    ] },
    { h: 'Information collected automatically', p: [
      'Basic usage and device information needed to run the app reliably (for example, app version and general activity such as views or plays).',
      'A push-notification token, if you enable notifications, so we can deliver them.',
    ] },
    { h: 'How we use your information', p: [
      'To provide core features — your feed, music, communities, messaging, live events and the marketplace.',
      'To operate accounts, keep the service secure, prevent abuse, and enforce our Terms and Community Guidelines.',
      'To send you notifications you have opted into, and important account or service messages.',
    ] },
    { h: 'How your information is shared', p: [
      'With other users: content you post is shown according to your settings (for example, a public profile is visible to anyone; a private profile is limited to approved followers).',
      'With service providers who process data on our behalf — media hosting/CDN (Cloudflare R2 / Cloudinary), payments (Stripe), email delivery, and push notifications — only as needed to run the app.',
      'For legal reasons, if required by law or to protect the rights, safety and security of our users and the service.',
      'We do not sell your personal information.',
    ] },
    { h: 'Your choices and rights', p: [
      'Edit or delete your posts and comments at any time.',
      'Make your account private, and block accounts you do not want to interact with.',
      'Control which notifications you receive in Settings.',
      'Deactivate or permanently delete your account from Settings → your account. Deleting removes your account and associated content, subject to limited retention below.',
    ] },
    { h: 'Data retention', p: [
      'We keep your information while your account is active. When you delete your account we remove your content and personal data, except where we must retain limited records to comply with legal obligations, resolve disputes, or prevent abuse.',
    ] },
    { h: "Children's privacy", p: [
      'The app is not intended for children under the age required by law in your country. We do not knowingly collect personal information from children below that age; if you believe a child has provided us data, contact us and we will remove it.',
    ] },
    { h: 'Security', p: [
      'We use reasonable technical and organisational measures to protect your information (including hashed passwords and encrypted connections). No system is perfectly secure, so we cannot guarantee absolute security.',
    ] },
    { h: 'Changes to this policy', p: [
      'We may update this policy from time to time. We will revise the "last updated" date above and, for significant changes, provide additional notice in the app.',
    ] },
    { h: 'Contact us', p: [
      `Questions about privacy? Email ${LEGAL.contactEmail}.`,
    ] },
  ],
);

export const TERMS = P(
  `Last updated: ${LEGAL.effectiveDate}`,
  `These Terms of Service ("Terms") govern your use of ${LEGAL.entity} (the "app"). By creating an account or using the app you agree to these Terms.`,
  [
    { h: 'Eligibility and your account', p: [
      'You must meet the minimum age required by law in your country to use the app, and provide accurate information when you register.',
      'You are responsible for your account and for keeping your password confidential. Usernames must be unique and must not impersonate others.',
    ] },
    { h: 'Your content', p: [
      'You keep ownership of the content you post. You grant us a non-exclusive, worldwide, royalty-free licence to host, store, display and distribute that content solely to operate and promote the app.',
      'You are responsible for the content you post and confirm you have the rights to share it. Do not post content that infringes others’ rights or breaks the law.',
    ] },
    { h: 'Acceptable use', p: [
      'You agree to follow our Community Guidelines. Do not misuse the app, interfere with its operation, attempt to access it in unauthorised ways, or use it to harm others.',
    ] },
    { h: 'Marketplace', p: [
      'The marketplace lets users list and buy items. Payments are processed by Stripe. Sellers are responsible for their listings, fulfilment and compliance with applicable law; buyers are responsible for their purchases. We are not a party to transactions between users and provide no warranty on user-listed items.',
    ] },
    { h: 'Intellectual property', p: [
      'The app itself, including its name, design and software, is owned by us or our licensors and protected by law. These Terms do not grant you rights to our branding except as needed to use the app.',
    ] },
    { h: 'Moderation and termination', p: [
      'We may remove content or suspend or terminate accounts that violate these Terms or our Community Guidelines, or where necessary to protect users or the service. You may stop using the app and delete your account at any time.',
    ] },
    { h: 'Disclaimers and limitation of liability', p: [
      'The app is provided "as is" without warranties of any kind. To the fullest extent permitted by law, we are not liable for indirect or consequential losses, or for content posted by users.',
    ] },
    { h: 'Governing law', p: [
      `These Terms are governed by the laws of ${LEGAL.jurisdiction}, and disputes will be handled by the courts located there, unless your local law requires otherwise.`,
    ] },
    { h: 'Changes to these Terms', p: [
      'We may update these Terms from time to time. Continued use of the app after changes take effect means you accept the updated Terms.',
    ] },
    { h: 'Contact us', p: [
      `Questions about these Terms? Email ${LEGAL.contactEmail}.`,
    ] },
  ],
);

export const GUIDELINES = P(
  `Last updated: ${LEGAL.effectiveDate}`,
  `${LEGAL.entity} is a home for the worldwide Adventist community — worship, music, fellowship and sharing. These guidelines keep it a safe, respectful place for everyone.`,
  [
    { h: 'Be respectful', p: [
      'Treat others with kindness and grace, even in disagreement. Personal attacks, harassment, bullying and threats are not allowed.',
    ] },
    { h: 'Keep it appropriate', p: [
      'Do not post hateful, violent, sexually explicit, or otherwise harmful content. No content that promotes illegal activity, self-harm, or exploitation.',
    ] },
    { h: 'Be authentic', p: [
      'Be yourself. Do not impersonate other people, ministries or organisations, and do not create deceptive or spam accounts.',
    ] },
    { h: 'No spam or scams', p: [
      'Do not flood the community with repetitive posts, misleading links, or fraudulent marketplace listings.',
    ] },
    { h: 'Respect privacy and copyright', p: [
      "Don't share other people's private information without consent, and only post music, images and other media you have the right to share.",
    ] },
    { h: 'Reporting and enforcement', p: [
      'If you see something that breaks these guidelines, use the report option on the post or message, or block the account. Our moderators review reports and may remove content, or warn, suspend or remove accounts that break the rules.',
    ] },
    { h: 'Contact us', p: [
      `Questions or safety concerns? Email ${LEGAL.contactEmail}.`,
    ] },
  ],
);

// Map used by the generic renderer + navigation.
export const LEGAL_DOCS = {
  privacy: { titleKey: 'legal.privacyTitle', doc: PRIVACY },
  terms: { titleKey: 'legal.termsTitle', doc: TERMS },
  guidelines: { titleKey: 'legal.guidelinesTitle', doc: GUIDELINES },
};
