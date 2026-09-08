'use strict';
'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';

interface CompanyData {
  id: string;
  company_name: string;
  username: string;
  status: string;
  item_count: number;
  last_sync_at: string | null;
  sync_status: string;
  created_at: string;
  updated_at: string;
}

interface DriveStatusData {
  connected: boolean;
  folder_id?: string | null;
  file_id?: string | null;
  file_name?: string | null;
}

export default function AdminDashboardPage() {
  const [company, setCompany] = useState<CompanyData | null>(null);
  const [driveStatus, setDriveStatus] = useState<DriveStatusData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    async function loadData() {
      try {
        const [meRes, driveRes] = await Promise.all([
          fetch('/api/auth/me'),
          fetch('/api/google-drive/status'),
        ]);

        if (meRes.ok) {
          const meData = await meRes.json();
          if (meData.success) {
            setCompany(meData.data.company);
          }
        }

        if (driveRes.ok) {
          const driveData = await driveRes.json();
          if (driveData.success) {
            setDriveStatus(driveData.data);
          }
        }
      } catch (e) {
        console.error('Failed to load dashboard metrics:', e);
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
  }, []);

  if (isLoading) {
    return (
      <div className="bg-[#14142B] rounded-2xl border border-[#2A2A4A] p-8 text-center text-white/50">
        Loading dashboard metrics...
      </div>
    );
  }

  const isActive = company?.status === 'ACTIVE';
  const hasSynced = Boolean(company?.last_sync_at);

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-[#14142B] via-[#1E1738] to-[#14142B] rounded-2xl border border-[#2A2A4A] p-6 shadow-xl relative overflow-hidden">
        <div className="relative z-10 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="text-xs font-bold uppercase tracking-wider text-[#FF8C00]">
              Company Overview
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white mt-1">
              {company?.company_name || 'Your Company'}
            </h1>
            <p className="text-sm text-white/60 mt-1">
              Internal ID: <span className="font-mono text-xs text-white/40">{company?.id}</span>
            </p>
          </div>

          <div className="flex items-center gap-3">
            <div className={`px-3.5 py-1.5 rounded-full text-xs font-bold flex items-center gap-2 border ${
              isActive
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                : 'bg-red-500/10 text-red-400 border-red-500/30'
            }`}>
              <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-emerald-400 animate-pulse' : 'bg-red-400'}`} />
              <span>{isActive ? 'ACTIVE ACCOUNT' : 'DISABLED'}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Primary Metrics Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {/* Metric 1: Login Username */}
        <div className="bg-[#14142B] rounded-2xl border border-[#2A2A4A] p-6 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-white/60">
              Shared Username
            </span>
            <div className="p-2 rounded-xl bg-orange-500/10 text-[#FF8C00]">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
          </div>
          <div className="mt-4">
            <div className="text-2xl font-extrabold text-white font-mono tracking-wide">
              {company?.username || '—'}
            </div>
            <Link
              href="/admin/credentials"
              className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-[#FF8C00] hover:underline"
            >
              <span>Manage Credentials</span>
              <span>→</span>
            </Link>
          </div>
        </div>

        {/* Metric 2: Item Records */}
        <div className="bg-[#14142B] rounded-2xl border border-[#2A2A4A] p-6 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-white/60">
              Catalog Items
            </span>
            <div className="p-2 rounded-xl bg-blue-500/10 text-blue-400">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
              </svg>
            </div>
          </div>
          <div className="mt-4">
            <div className="text-3xl font-extrabold text-white">
              {company?.item_count ?? 0}
            </div>
            <p className="mt-1 text-xs text-white/40">
              Total items indexed for mobile scanning
            </p>
          </div>
        </div>

        {/* Metric 3: Synchronization */}
        <div className="bg-[#14142B] rounded-2xl border border-[#2A2A4A] p-6 flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-white/60">
              Last Sync
            </span>
            <div className="p-2 rounded-xl bg-purple-500/10 text-purple-400">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
          </div>
          <div className="mt-4">
            <div className="text-base font-bold text-white">
              {hasSynced ? new Date(company!.last_sync_at!).toLocaleString() : 'Not synchronized'}
            </div>
            <p className="mt-1 text-xs text-white/40">
              Status: <span className="font-semibold text-white/70">{company?.sync_status || 'IDLE'}</span>
            </p>
          </div>
        </div>
      </div>

      {/* Google Drive Status Section */}
      <div className="bg-[#14142B] rounded-2xl border border-[#2A2A4A] p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
              driveStatus?.connected ? 'bg-emerald-500/15 text-emerald-400' : 'bg-white/5 text-white/40'
            }`}>
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 00-9.78 2.096A4.001 4.001 0 003 15z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-base font-bold text-white">Google Drive</h2>
                <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${
                  driveStatus?.connected
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : 'bg-white/5 text-white/50 border-white/10'
                }`}>
                  {driveStatus?.connected ? '● Connected' : '○ Not Connected'}
                </span>
              </div>
              <p className="text-xs text-white/50 mt-1">
                {driveStatus?.connected
                  ? 'Private company Google Drive connected via OAuth 2.0.'
                  : "Connect your company's Google Drive to select the itemmast.xlsx data source."}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {!driveStatus?.connected ? (
              <Link
                href="/admin/drive"
                className="px-5 py-2.5 rounded-xl font-bold text-xs tracking-wider text-white bg-gradient-to-r from-[#FF8C00] to-[#E53935] hover:opacity-90 transition cursor-pointer shadow-lg shadow-orange-500/10"
              >
                CONNECT GOOGLE DRIVE
              </Link>
            ) : (
              <div className="flex items-center gap-2">
                <Link
                  href="/admin/drive"
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[#FF8C00] bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/20 transition cursor-pointer"
                >
                  Change File
                </Link>
                <Link
                  href="/admin/drive"
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white/80 bg-white/5 hover:bg-white/10 border border-white/10 transition cursor-pointer"
                >
                  Test Connection
                </Link>
                <Link
                  href="/admin/drive"
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 transition cursor-pointer"
                >
                  Disconnect
                </Link>
              </div>
            )}
          </div>
        </div>

        {driveStatus?.connected && (
          <div className="mt-6 pt-5 border-t border-[#2A2A4A]/80 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div className="p-3.5 rounded-xl bg-[#0F0F22] border border-[#2A2A4A]">
              <div className="text-white/40 font-semibold uppercase tracking-wider text-[10px]">Selected File</div>
              <div className="text-sm font-bold text-white mt-1">{driveStatus.file_name || 'itemmast.xlsx'}</div>
            </div>
            <div className="p-3.5 rounded-xl bg-[#0F0F22] border border-[#2A2A4A]">
              <div className="text-white/40 font-semibold uppercase tracking-wider text-[10px]">File ID</div>
              <div className="font-mono text-white/70 mt-1 truncate">{driveStatus.file_id || 'Stored securely'}</div>
            </div>
            <div className="p-3.5 rounded-xl bg-[#0F0F22] border border-[#2A2A4A]">
              <div className="text-white/40 font-semibold uppercase tracking-wider text-[10px]">Last Connection Test</div>
              <div className="text-emerald-400 font-bold mt-1 flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span>Successful</span>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Quick Action Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Link
          href="/admin/profile"
          className="p-5 rounded-2xl bg-[#14142B] border border-[#2A2A4A] hover:border-[#FF8C00]/50 transition group flex items-center justify-between"
        >
          <div>
            <div className="text-sm font-bold text-white group-hover:text-[#FF8C00] transition">
              Update Company Profile
            </div>
            <div className="text-xs text-white/40 mt-1">
              Edit company display name and review account details.
            </div>
          </div>
          <span className="text-white/30 group-hover:text-[#FF8C00] transition text-lg">→</span>
        </Link>

        <Link
          href="/admin/credentials"
          className="p-5 rounded-2xl bg-[#14142B] border border-[#2A2A4A] hover:border-[#FF8C00]/50 transition group flex items-center justify-between"
        >
          <div>
            <div className="text-sm font-bold text-white group-hover:text-[#FF8C00] transition">
              Change Username or Password
            </div>
            <div className="text-xs text-white/40 mt-1">
              Securely update credentials with mandatory password verification.
            </div>
          </div>
          <span className="text-white/30 group-hover:text-[#FF8C00] transition text-lg">→</span>
        </Link>
      </div>
    </div>
  );
}
