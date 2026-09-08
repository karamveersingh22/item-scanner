import React from 'react';
import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Item Scanner — Inventory and Item Master Management',
  description:
    'Item Scanner is an inventory lookup application designed to provide fast access to item master information using barcode scanning and local catalog data.',
};

export default function HomePage() {
  return (
    <div className="min-h-screen bg-[#0D0D1A] text-white flex flex-col justify-between selection:bg-orange-500/30">
      {/* Navigation Header */}
      <header className="border-b border-white/10 bg-[#121224]/80 backdrop-blur-md sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-[#FF8C00] to-[#E53935] flex items-center justify-center shadow-md shadow-orange-500/20">
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
            <span className="font-bold text-lg tracking-tight text-white">Item Scanner</span>
          </div>

          <nav className="flex items-center space-x-4 text-sm font-medium">
            <Link
              href="/privacy"
              className="text-slate-400 hover:text-white transition-colors"
            >
              Privacy Policy
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
      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-16 sm:py-24 flex-1">
        {/* Hero Section */}
        <div className="text-center max-w-3xl mx-auto space-y-6">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-semibold bg-orange-500/10 text-orange-400 border border-orange-500/20">
            <span>Enterprise Inventory System</span>
          </div>

          <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight">
            <span className="text-white">Item </span>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#FF8C00] to-[#E53935]">
              Scanner
            </span>
          </h1>

          <p className="text-xl sm:text-2xl font-medium text-slate-300">
            Inventory and Item Master Management System
          </p>

          <p className="text-base sm:text-lg text-slate-400 leading-relaxed max-w-2xl mx-auto">
            Item Scanner is an inventory lookup application designed to provide fast access to item
            master information using barcode scanning and local catalog data.
          </p>
        </div>

        {/* Features Grid */}
        <div className="mt-16 sm:mt-20">
          <h2 className="text-xs font-bold uppercase tracking-widest text-slate-400 text-center mb-8">
            Core Capabilities
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div className="bg-[#1A1A2E]/70 border border-white/10 rounded-2xl p-6 backdrop-blur-sm">
              <div className="w-10 h-10 rounded-xl bg-orange-500/10 text-orange-400 flex items-center justify-center mb-4 border border-orange-500/20">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h3 className="font-semibold text-white text-base mb-2">Fast Barcode & Item-Code Lookup</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Instant search and recognition for item codes directly through barcode and optical scanning.
              </p>
            </div>

            <div className="bg-[#1A1A2E]/70 border border-white/10 rounded-2xl p-6 backdrop-blur-sm">
              <div className="w-10 h-10 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center mb-4 border border-blue-500/20">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 12h14M12 5l7 7-7 7" />
                </svg>
              </div>
              <h3 className="font-semibold text-white text-base mb-2">Offline-First Item Catalog Access</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Local indexing ensures inventory records remain instantly accessible even with intermittent connectivity.
              </p>
            </div>

            <div className="bg-[#1A1A2E]/70 border border-white/10 rounded-2xl p-6 backdrop-blur-sm">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-400 flex items-center justify-center mb-4 border border-emerald-500/20">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <h3 className="font-semibold text-white text-base mb-2">Secure Data Source Sync</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Protected synchronization with the configured company data source with automatic version verification.
              </p>
            </div>

            <div className="bg-[#1A1A2E]/70 border border-white/10 rounded-2xl p-6 backdrop-blur-sm">
              <div className="w-10 h-10 rounded-xl bg-purple-500/10 text-purple-400 flex items-center justify-center mb-4 border border-purple-500/20">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                </svg>
              </div>
              <h3 className="font-semibold text-white text-base mb-2">Google Drive Integration</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Connects directly to Google Drive to locate and retrieve the administrator-selected item master spreadsheet.
              </p>
            </div>

            <div className="bg-[#1A1A2E]/70 border border-white/10 rounded-2xl p-6 backdrop-blur-sm md:col-span-2 lg:col-span-2">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 text-amber-400 flex items-center justify-center mb-4 border border-amber-500/20">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
              </div>
              <h3 className="font-semibold text-white text-base mb-2">Company-Managed Catalog Synchronization</h3>
              <p className="text-sm text-slate-400 leading-relaxed">
                Empowers authorized personnel to trigger, review, and manage atomic catalog updates from the administration panel.
              </p>
            </div>
          </div>
        </div>

        {/* Security Statement */}
        <div className="mt-12 bg-[#121224] border border-white/10 rounded-2xl p-6 sm:p-8 text-center max-w-2xl mx-auto">
          <div className="w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-400 mx-auto mb-3 flex items-center justify-center">
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="text-base font-semibold text-white mb-2">Security Statement</h3>
          <p className="text-sm text-slate-400 leading-relaxed">
            The application uses secure server-side authentication and protected storage for
            configuration and synchronization credentials.
          </p>
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/10 bg-[#0A0A14] py-8">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-400">
          <div>
            <span>&copy; Item Scanner</span>
          </div>
          <div className="flex items-center space-x-6">
            <Link href="/privacy" className="hover:text-white transition-colors">
              Privacy Policy
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
