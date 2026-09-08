import React from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Privacy Policy — Item Scanner',
  description: 'Privacy Policy for the Item Scanner application.',
};

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-[#0D0D1A] text-white flex flex-col justify-between selection:bg-orange-500/30">
      {/* Navigation Header */}
      <header className="border-b border-white/10 bg-[#121224]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center space-x-3 group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#FF8C00] to-[#E53935] flex items-center justify-center shadow-md shadow-orange-500/20 group-hover:scale-105 transition-transform">
              <svg
                className="w-5 h-5 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
                />
              </svg>
            </div>
            <span className="font-bold text-lg tracking-tight text-white group-hover:text-orange-400 transition-colors">
              Item Scanner
            </span>
          </Link>

          <nav className="flex items-center space-x-4 text-sm font-medium">
            <Link href="/" className="text-slate-400 hover:text-white transition-colors">
              Home
            </Link>
            <Link
              href="/admin/login"
              className="px-3.5 py-1.5 rounded-lg bg-white/10 hover:bg-white/15 text-slate-200 border border-white/10 transition-colors"
            >
              Admin Portal
            </Link>
          </nav>
        </div>
      </header>

      {/* Main Content */}
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-12 sm:py-16 flex-1 w-full">
        <div className="space-y-4 border-b border-white/10 pb-8 mb-10">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-orange-500/10 text-orange-400 border border-orange-500/20">
            <span>Legal & Privacy</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight text-white">
            Privacy Policy
          </h1>
          <p className="text-slate-400 text-sm">
            Application: <span className="text-slate-200 font-semibold">Item Scanner</span>
          </p>
        </div>

        <div className="space-y-10 text-slate-300 leading-relaxed text-sm sm:text-base">
          {/* Section 1 */}
          <section className="bg-[#1A1A2E]/50 border border-white/10 rounded-2xl p-6 sm:p-8">
            <h2 className="text-lg sm:text-xl font-bold text-white mb-3 flex items-center gap-3">
              <span className="text-orange-400 text-base font-mono">1.</span> Overview
            </h2>
            <p className="text-slate-300">
              Item Scanner is an inventory and item-master application designed to provide authorized
              users with fast, reliable access to company item information through barcode scanning,
              optical recognition, and local catalog queries.
            </p>
          </section>

          {/* Section 2 */}
          <section className="bg-[#1A1A2E]/50 border border-white/10 rounded-2xl p-6 sm:p-8">
            <h2 className="text-lg sm:text-xl font-bold text-white mb-3 flex items-center gap-3">
              <span className="text-orange-400 text-base font-mono">2.</span> Information We Access
            </h2>
            <p className="mb-3 text-slate-300">
              When configured by an authorized administrator, the application may access:
            </p>
            <ul className="list-disc list-inside space-y-2 text-slate-400 pl-2">
              <li>
                <span className="text-slate-200 font-medium">Google Account Email Information:</span> Used
                solely to identify the authorized Google account connecting the integration.
              </li>
              <li>
                <span className="text-slate-200 font-medium">Google Drive File Metadata:</span> Information
                strictly necessary to locate, display, and retrieve the administrator-selected item
                master file.
              </li>
              <li>
                <span className="text-slate-200 font-medium">Item Master File Content:</span> The contents
                and tabular data of the administrator-selected item master spreadsheet (such as item
                codes, item names, descriptions, quantities, rates, and discount information) when
                present in the configured catalog.
              </li>
            </ul>
            <p className="mt-4 text-xs sm:text-sm text-slate-400 bg-white/5 border border-white/10 rounded-xl p-3">
              The application does not request or claim access to all files in Google Drive, and only accesses files authorized or selected by the administrator.
            </p>
          </section>

          {/* Section 3 */}
          <section className="bg-[#1A1A2E]/50 border border-white/10 rounded-2xl p-6 sm:p-8">
            <h2 className="text-lg sm:text-xl font-bold text-white mb-3 flex items-center gap-3">
              <span className="text-orange-400 text-base font-mono">3.</span> Google Drive Access
            </h2>
            <div className="space-y-3 text-slate-300">
              <p>
                The application uses Google OAuth 2.0 to allow an authorized administrator to connect a Google
                Drive account.
              </p>
              <p>
                The application uses Google Drive access exclusively for the configured item master
                synchronization workflow.
              </p>
              <p>
                The application does not intentionally read, inspect, or process unrelated Google Drive
                files.
              </p>
              <p>
                The administrator can disconnect the Google Drive integration at any time through the
                management panel, which immediately clears stored authorization tokens.
              </p>
            </div>
          </section>

          {/* Section 4 */}
          <section className="bg-[#1A1A2E]/50 border border-white/10 rounded-2xl p-6 sm:p-8">
            <h2 className="text-lg sm:text-xl font-bold text-white mb-3 flex items-center gap-3">
              <span className="text-orange-400 text-base font-mono">4.</span> How Information Is Used
            </h2>
            <p className="mb-3 text-slate-300">
              Information accessed by the application is used solely to:
            </p>
            <ul className="list-disc list-inside space-y-2 text-slate-400 pl-2">
              <li>Authenticate the authorized administrator</li>
              <li>Connect the configured Google Drive account</li>
              <li>Locate and retrieve the administrator-selected item master spreadsheet file</li>
              <li>Synchronize item-master and catalog information into the application</li>
              <li>Provide offline-first item search and lookup functionality to authorized users</li>
            </ul>
          </section>

          {/* Section 5 */}
          <section className="bg-[#1A1A2E]/50 border border-white/10 rounded-2xl p-6 sm:p-8">
            <h2 className="text-lg sm:text-xl font-bold text-white mb-3 flex items-center gap-3">
              <span className="text-orange-400 text-base font-mono">5.</span> Storage and Security
            </h2>
            <p className="text-slate-300">
              OAuth credentials, authorization tokens, and application configuration are stored on the
              server using protected storage and encryption mechanisms implemented by the application.
              Sensitive authentication tokens are protected at rest and are never returned or exposed
              to client-side scripts, public endpoints, or unauthorized parties.
            </p>
          </section>

          {/* Section 6 */}
          <section className="bg-[#1A1A2E]/50 border border-white/10 rounded-2xl p-6 sm:p-8">
            <h2 className="text-lg sm:text-xl font-bold text-white mb-3 flex items-center gap-3">
              <span className="text-orange-400 text-base font-mono">6.</span> Data Sharing
            </h2>
            <div className="space-y-3 text-slate-300">
              <p>
                The application does not sell personal information or catalog data.
              </p>
              <p>
                Google account and Google Drive information is not intentionally shared with third-party
                advertisers or data brokers.
              </p>
              <p>
                Information may be processed by infrastructure and service providers strictly required to
                operate the application, such as verified hosting and cloud storage services.
              </p>
            </div>
          </section>

          {/* Section 7 */}
          <section className="bg-[#1A1A2E]/50 border border-white/10 rounded-2xl p-6 sm:p-8">
            <h2 className="text-lg sm:text-xl font-bold text-white mb-3 flex items-center gap-3">
              <span className="text-orange-400 text-base font-mono">7.</span> Data Retention
            </h2>
            <p className="text-slate-300">
              Synchronization data and application configuration may be retained as necessary to operate
              the inventory management service and provide offline catalog lookups. The administrator
              can disconnect the Google Drive integration at any time, which removes active synchronization
              tokens.
            </p>
          </section>

          {/* Section 8 */}
          <section className="bg-[#1A1A2E]/50 border border-white/10 rounded-2xl p-6 sm:p-8">
            <h2 className="text-lg sm:text-xl font-bold text-white mb-3 flex items-center gap-3">
              <span className="text-orange-400 text-base font-mono">8.</span> User Control
            </h2>
            <p className="text-slate-300">
              The authorized administrator maintains complete control over connected cloud services and
              can disconnect the Google Drive integration through the management interface at any time.
            </p>
          </section>

          {/* Section 9 */}
          <section className="bg-[#1A1A2E]/50 border border-white/10 rounded-2xl p-6 sm:p-8">
            <h2 className="text-lg sm:text-xl font-bold text-white mb-3 flex items-center gap-3">
              <span className="text-orange-400 text-base font-mono">9.</span> Contact
            </h2>
            <p className="text-slate-300">
              Contact the application administrator for privacy questions.
            </p>
          </section>

          {/* Section 10 */}
          <section className="bg-[#1A1A2E]/50 border border-white/10 rounded-2xl p-6 sm:p-8">
            <h2 className="text-lg sm:text-xl font-bold text-white mb-3 flex items-center gap-3">
              <span className="text-orange-400 text-base font-mono">10.</span> Changes to This Privacy Policy
            </h2>
            <p className="text-slate-300">
              This Privacy Policy may be updated from time to time when application functionality or data
              handling practices change. Any revisions will be reflected on this page with an updated
              effective context.
            </p>
          </section>
        </div>

        <div className="mt-12 pt-8 border-t border-white/10 flex justify-between items-center text-sm">
          <Link href="/" className="text-orange-400 hover:text-orange-300 transition-colors flex items-center gap-2">
            <span>&larr;</span> Back to Home
          </Link>
          <Link href="/admin/login" className="text-slate-400 hover:text-white transition-colors">
            Admin Portal &rarr;
          </Link>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 bg-[#0A0A14] py-8">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400">
          <div>
            <span>&copy; Item Scanner</span>
          </div>
          <div className="flex items-center space-x-6">
            <Link href="/" className="hover:text-white transition-colors">
              Home
            </Link>
            <Link href="/admin/login" className="hover:text-white transition-colors">
              Admin Login
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
