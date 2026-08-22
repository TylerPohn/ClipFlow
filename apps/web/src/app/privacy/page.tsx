import styles from './page.module.css';

export const metadata = {
  title: 'Privacy Policy - Cliptopus',
};

export default function PrivacyPolicy() {
  return (
    <div className={styles.container}>
      <h1>Privacy Policy</h1>
      <p className={styles.updated}>Last updated: August 22, 2026</p>

      <p>
        This Privacy Policy describes how Cliptopus (&ldquo;Service&rdquo;,
        &ldquo;we&rdquo;, &ldquo;us&rdquo;, or &ldquo;our&rdquo;) collects,
        uses, and protects your information when you use our video repurposing
        platform. By using the Service, you agree to the collection and use of
        information in accordance with this policy.
      </p>

      <h2>1. Information We Collect</h2>

      <h3>1.1 Account Information</h3>
      <p>When you sign up using GitHub OAuth, we collect:</p>
      <ul>
        <li>Your name (as provided by your GitHub profile)</li>
        <li>Your email address (as provided by your GitHub profile)</li>
        <li>Your GitHub user ID (used as an account identifier)</li>
      </ul>

      <h3>1.2 YouTube Account Data</h3>
      <p>
        Cliptopus uses YouTube API Services. When you connect your YouTube
        account, we access and store:
      </p>
      <ul>
        <li>YouTube OAuth access and refresh tokens</li>
        <li>
          Your YouTube channel ID, name, handle, profile image, and uploads
          playlist ID
        </li>
        <li>
          Metadata for videos on your connected channel, including video IDs,
          titles, descriptions, tags, thumbnails, duration, publication date,
          and engagement statistics
        </li>
      </ul>
      <p>
        We use this information only to connect the channel you select, display
        and synchronize your uploads inside Cliptopus, let you import videos,
        and upload videos to YouTube when you expressly direct us to do so. We
        do not collect or store your Google or YouTube password.
      </p>

      <h3>1.3 TikTok Account Data</h3>
      <p>When you connect your TikTok account, we collect and store:</p>
      <ul>
        <li>
          TikTok OAuth access tokens and refresh tokens (used to publish videos
          on your behalf)
        </li>
        <li>Your TikTok account identifier</li>
      </ul>
      <p>
        We do not store your TikTok password. Access tokens are used solely to
        post videos to your TikTok account as you direct.
      </p>

      <h3>1.4 Video and Content Data</h3>
      <p>When you use the Service to process videos, we collect and store:</p>
      <ul>
        <li>YouTube video URLs you submit</li>
        <li>Video metadata (title, duration, resolution)</li>
        <li>Processed video files (stored in cloud storage)</li>
        <li>Transcripts generated from video audio</li>
      </ul>

      <h3>1.5 Usage Data</h3>
      <p>
        We automatically collect certain information about how you use the
        Service, including:
      </p>
      <ul>
        <li>Features used and actions taken within the Service</li>
        <li>Export and publish activity</li>
        <li>Subscription tier and usage counts</li>
        <li>Timestamps of account activity</li>
      </ul>

      <h3>1.6 Cookies and Session Data</h3>
      <p>
        We use minimal cookies strictly necessary for the operation of the
        Service:
      </p>
      <ul>
        <li>
          <strong>Session cookies</strong>: Used to maintain your authenticated
          session after login. These are essential for the Service to function
          and expire when you log out or after a period of inactivity.
        </li>
      </ul>
      <p>
        We do not use advertising cookies, tracking pixels, or third-party
        analytics cookies.
      </p>

      <h2>2. How We Use Your Information</h2>
      <p>We use the information we collect for the following purposes:</p>
      <ul>
        <li>
          <strong>Providing the Service</strong>: Synchronizing your connected
          YouTube channel, processing your videos, generating captions via
          transcription, converting video formats, and publishing to YouTube,
          YouTube Shorts, TikTok, Instagram, or X only when you direct us to do
          so.
        </li>
        <li>
          <strong>Account management</strong>: Authenticating your identity,
          managing your subscription, and enforcing usage limits.
        </li>
        <li>
          <strong>Communication</strong>: Sending service-related notifications
          such as subscription confirmations, usage alerts, and important
          updates about the Service.
        </li>
        <li>
          <strong>Service improvement</strong>: Analyzing usage patterns in
          aggregate to improve features, performance, and reliability.
        </li>
        <li>
          <strong>Security</strong>: Detecting and preventing fraud, abuse, and
          unauthorized access.
        </li>
      </ul>
      <p>
        We do not sell your personal information to third parties. We do not use
        your content to train machine learning models.
      </p>

      <h2>3. Third-Party Services</h2>
      <p>
        To provide our functionality, we share certain data with the following
        third-party services:
      </p>

      <h3>3.1 YouTube API Services</h3>
      <p>
        Cliptopus uses YouTube API Services to retrieve authorized channel and
        video information and to upload videos and associated metadata to the
        YouTube channel you select. These transfers occur only as necessary to
        provide user-facing features that you request. Your use of these
        features is also governed by the{' '}
        <a
          href="https://www.youtube.com/t/terms"
          target="_blank"
          rel="noopener noreferrer"
        >
          YouTube Terms of Service
        </a>{' '}
        and the{' '}
        <a
          href="https://policies.google.com/privacy"
          target="_blank"
          rel="noopener noreferrer"
        >
          Google Privacy Policy
        </a>
        .
      </p>
      <p>
        Cliptopus&apos;s use and transfer of information received from Google
        APIs adheres to the{' '}
        <a
          href="https://developers.google.com/terms/api-services-user-data-policy"
          target="_blank"
          rel="noopener noreferrer"
        >
          Google API Services User Data Policy
        </a>
        , including its Limited Use requirements. We do not sell Google user
        data, use it for advertising, or use it to train generalized
        machine-learning or AI models.
      </p>

      <h3>3.2 TikTok</h3>
      <p>
        When you publish a video through Cliptopus, the processed video file and
        any associated metadata (title, description, captions) are uploaded to
        TikTok via their API. This transfer is initiated by you and governed by
        TikTok&apos;s Privacy Policy.
      </p>

      <h3>3.3 OpenAI</h3>
      <p>
        Audio extracted from your videos is sent to OpenAI&apos;s Whisper API
        for transcription. Only the audio content is transmitted; no account
        information or other personal data is included.
      </p>

      <h3>3.4 Cloud Storage Provider</h3>
      <p>
        Video files (both original and processed) are stored using cloud object
        storage. Files are stored securely and are not publicly accessible.
        Access is restricted to your account and our service infrastructure.
      </p>

      <h3>3.5 Payment Processor</h3>
      <p>
        If you subscribe to a paid plan, your payment information is handled by
        our third-party payment processor. We do not directly store your credit
        card number or full payment details on our servers.
      </p>

      <h2>4. Data Retention</h2>
      <ul>
        <li>
          <strong>Video files</strong>: Stored in cloud storage until you delete
          them through the Service or until your account is terminated.
        </li>
        <li>
          <strong>Transcripts and metadata</strong>: Retained as long as the
          associated video exists in your account.
        </li>
        <li>
          <strong>Account data</strong>: Retained while your account is active.
          If you delete your account, we will delete your personal data within
          30 days, except where retention is required by law.
        </li>
        <li>
          <strong>YouTube access tokens and API data</strong>: Stored while your
          YouTube account is connected and needed to provide the features you
          request. When you disconnect YouTube, Cliptopus revokes and deletes
          stored YouTube tokens and removes synchronized YouTube API data
          associated with that connection.
        </li>
        <li>
          <strong>YouTube metadata and statistics</strong>: Refreshed or deleted
          within 30 days so stored API data remains current and authorized.
        </li>
        <li>
          <strong>TikTok access tokens</strong>: Stored while your TikTok
          account is connected. Tokens are deleted when you disconnect your
          TikTok account or delete your Cliptopus account.
        </li>
        <li>
          <strong>Usage logs</strong>: Retained for up to 12 months for security
          and service improvement purposes, then deleted or anonymized.
        </li>
      </ul>

      <h2>5. Your Rights</h2>
      <p>You have the following rights regarding your data:</p>
      <ul>
        <li>
          <strong>Access</strong>: You can request a copy of the personal data
          we hold about you.
        </li>
        <li>
          <strong>Deletion</strong>: You can delete your account and all
          associated data at any time. You can also delete individual videos and
          their associated transcripts and metadata.
        </li>
        <li>
          <strong>Export</strong>: You can download your processed videos and
          transcripts at any time through the Service.
        </li>
        <li>
          <strong>Correction</strong>: You can update your account information
          through your profile settings.
        </li>
        <li>
          <strong>Revoke third-party access</strong>: You can disconnect YouTube
          or TikTok through the Cliptopus Platforms page. You can also revoke
          Google access through your{' '}
          <a
            href="https://security.google.com/settings/security/permissions"
            target="_blank"
            rel="noopener noreferrer"
          >
            Google Account security settings
          </a>
          . Disconnecting removes the corresponding stored OAuth tokens and
          associated synchronized API data.
        </li>
      </ul>
      <p>
        To exercise any of these rights, you can use the relevant features in
        the Service or contact us at the email address listed below.
      </p>

      <h2>6. Security Measures</h2>
      <p>
        We implement reasonable technical and organizational measures to protect
        your data, including:
      </p>
      <ul>
        <li>Encryption of data in transit using TLS/HTTPS</li>
        <li>Encryption of sensitive data at rest, including OAuth tokens</li>
        <li>
          Access controls restricting data access to authorized personnel and
          systems
        </li>
        <li>Regular review of security practices</li>
      </ul>
      <p>
        While we take reasonable steps to protect your information, no method of
        transmission over the Internet or electronic storage is completely
        secure. We cannot guarantee absolute security.
      </p>

      <h2>7. Children&apos;s Privacy</h2>
      <p>
        Cliptopus is not intended for use by anyone under the age of 13. We do
        not knowingly collect personal information from children under 13. If we
        become aware that we have collected data from a child under 13, we will
        take steps to delete that information promptly.
      </p>

      <h2>8. International Data Transfers</h2>
      <p>
        If you access the Service from outside the region where our servers are
        located, your data may be transferred across international borders. By
        using the Service, you consent to the transfer of your information to
        our servers and the third-party services described in this policy.
      </p>

      <h2>9. Changes to This Policy</h2>
      <p>
        We may update this Privacy Policy from time to time. We will notify
        users of material changes by posting the updated policy on our website
        and updating the &ldquo;Last updated&rdquo; date at the top. Your
        continued use of the Service after changes are posted constitutes your
        acceptance of the revised policy.
      </p>

      <h2>10. Contact Information</h2>
      <p>
        If you have any questions or concerns about this Privacy Policy or our
        data practices, please contact us at:
      </p>
      <p>
        <strong>Email</strong>: privacy@cliptopus.com
      </p>
    </div>
  );
}
