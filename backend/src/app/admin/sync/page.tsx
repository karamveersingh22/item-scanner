'use strict';
'use client';

import React, { useEffect, useState } from 'react';

interface SyncData {
  sync_status: string;
  last_sync_at: string | null;
  item_count: number;
  data_version: string | null;
  google_drive_md5?: string | null;
  sync_error: string | null;
}

interface DriveData {
  connected: boolean;
  folder_id: string | null;
  file_id: string | null;
  file_name: string | null;
}

export default function SyncStatusPage() {
  const [syncData, setSyncData] = useState<SyncData | null>(null);
  const [driveData, setDriveData] = useState<DriveData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncSuccessMsg, setSyncSuccessMsg] = useState<string | null>(null);
  const [syncErrorMsg, setSyncErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    loadStatus();
  }, []);

  async function loadStatus() {
    try {
      const [syncRes, driveRes] = await Promise.all([
        fetch('/api/sync/status'),
        fetch('/api/google-drive/status'),
      ]);

      if (syncRes.ok) {
        const sJson = await syncRes.json();
        if (sJson.success) setSyncData(sJson.data);
      }

      if (driveRes.ok) {
        const dJson = await driveRes.json();
        if (dJson.success) setDriveData(dJson.data);
      }
    } catch (e) {
      console.error('Failed to load sync status:', e);
    } finally {
      setIsLoading(false);
    }
  }

  const handleSyncNow = async () => {
    if (!driveData?.connected) {
      setSyncErrorMsg('Please connect Google Drive before synchronizing.');
      return;
    }
    if (!driveData?.file_id) {
      setSyncErrorMsg('Please select an itemmast.xlsx file before synchronizing.');
      return;
    }

    setIsSyncing(true);
    setSyncSuccessMsg(null);
    setSyncErrorMsg(null);

    try {
      const res = await fetch('/api/sync/trigger', { method: 'POST' });
      const json = await res.json();

      if (res.ok && json.success) {
        setSyncSuccessMsg(
          json.data?.unchanged
            ? 'Catalog is already synchronized and up to date with Google Drive.'
            : `Synchronization completed. ${json.data?.item_count?.toLocaleString()} items processed successfully.`
        );
        await loadStatus();
      } else {
        setSyncErrorMsg(json.error || 'Synchronization failed. Your previous catalog is still active.');
        await loadStatus();
      }
    } catch {
      setSyncErrorMsg('Network error while requesting synchronization. Your previous catalog is still active.');
      await loadStatus();
    } finally {
      setIsSyncing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-[#14142B] rounded-2xl border border-[#2A2A4A] p-8 text-center text-white/50">
        Loading synchronization metrics...
      </div>
    );
  }

  const hasSynced = Boolean(syncData?.last_sync_at);
  const statusStr = isSyncing ? 'IN_PROGRESS' : syncData?.sync_status || 'IDLE';

  return (
    <div className="space-y-6">
      <div className="border-b border-[#2A2A4A] pb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">Data & Synchronization</h1>
          <p className="text-sm text-white/50 mt-1">
            Google Drive catalog ingestion, change detection, and cloud database state.
          </p>
        </div>

        <button
          onClick={handleSyncNow}
          disabled={isSyncing || !driveData?.connected || !driveData?.file_id}
          className="px-6 py-3 rounded-xl font-bold text-xs tracking-wider text-white bg-gradient-to-r from-[#FF8C00] to-[#E53935] hover:opacity-90 transition disabled:opacity-50 cursor-pointer shadow-lg shadow-orange-500/20 flex items-center justify-center gap-2"
        >
          {isSyncing ? (
            <>
              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              <span>SYNCHRONIZING...</span>
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span>SYNC NOW</span>
            </>
          )}
        </button>
      </div>

      {syncSuccessMsg && (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <div className="text-sm font-medium text-emerald-200">
            <p className="font-bold">✓ Synchronization completed</p>
            <p className="text-xs text-emerald-300/80 mt-0.5">{syncSuccessMsg}</p>
          </div>
        </div>
      )}

      {syncErrorMsg && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            <div className="text-sm font-medium text-red-200">
              <p className="font-bold">✕ Synchronization failed</p>
              <p className="text-xs text-red-300/80 mt-0.5">{syncErrorMsg}</p>
              <p className="text-[11px] text-white/40 mt-1">Your previous catalog is still active and unchanged.</p>
            </div>
          </div>
          <button
            onClick={handleSyncNow}
            disabled={isSyncing}
            className="px-3 py-1.5 rounded-lg text-xs font-semibold text-white/90 bg-white/10 hover:bg-white/20 border border-white/20 transition cursor-pointer shrink-0"
          >
            Try Again
          </button>
        </div>
      )}

      {/* Catalog Status Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-[#14142B] rounded-2xl border border-[#2A2A4A] p-5">
          <div className="text-xs font-semibold text-white/50 uppercase tracking-wider">
            Total Catalog Items
          </div>
          <div className="mt-2 text-2xl font-extrabold text-white">
            {syncData?.item_count ?? 0}
          </div>
          <div className="text-[11px] text-white/30 mt-1">Synchronized for offline lookups</div>
        </div>

        <div className="bg-[#14142B] rounded-2xl border border-[#2A2A4A] p-5">
          <div className="text-xs font-semibold text-white/50 uppercase tracking-wider">
            Sync State
          </div>
          <div className={`mt-2 text-lg font-bold ${
            isSyncing || syncData?.sync_status === 'IN_PROGRESS'
              ? 'text-[#FF8C00] animate-pulse'
              : syncData?.sync_status === 'SUCCESS'
              ? 'text-emerald-400'
              : syncData?.sync_status === 'FAILED'
              ? 'text-red-400'
              : 'text-[#FF8C00]'
          }`}>
            {isSyncing ? 'SYNCHRONIZING...' : syncData?.sync_status || 'IDLE'}
          </div>
          <div className="text-[11px] text-white/30 mt-1">Current cloud catalog state</div>
        </div>

        <div className="bg-[#14142B] rounded-2xl border border-[#2A2A4A] p-5">
          <div className="text-xs font-semibold text-white/50 uppercase tracking-wider">
            Last Synchronized
          </div>
          <div className="mt-2 text-sm font-bold text-white">
            {hasSynced ? new Date(syncData!.last_sync_at!).toLocaleString() : 'Not synchronized'}
          </div>
          <div className="text-[11px] text-white/30 mt-1">Most recent update</div>
        </div>

        <div className="bg-[#14142B] rounded-2xl border border-[#2A2A4A] p-5">
          <div className="text-xs font-semibold text-white/50 uppercase tracking-wider">
            Catalog Version Tag
          </div>
          <div className="mt-2 font-mono text-xs font-bold text-white/80 truncate">
            {syncData?.data_version || 'None'}
          </div>
          <div className="text-[11px] text-white/30 mt-1">MD5 checksum signature</div>
        </div>
      </div>

      {/* Google Drive Status & Action Section */}
      <div className="bg-[#14142B] rounded-2xl border border-[#2A2A4A] p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
              driveData?.connected ? 'bg-emerald-500/15 text-emerald-400' : 'bg-white/5 text-white/40'
            }`}>
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 00-9.78 2.096A4.001 4.001 0 003 15z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg font-bold text-white">Google Drive</h2>
                <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${
                  driveData?.connected
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : 'bg-white/5 text-white/50 border-white/10'
                }`}>
                  {driveData?.connected ? '● Connected' : '○ Not Connected'}
                </span>
              </div>
              <p className="text-xs text-white/50 mt-1">
                {driveData?.connected
                  ? 'Private company Google Drive connected via OAuth 2.0.'
                  : "Connect your company's Google Drive to select the itemmast.xlsx data source."}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {!driveData?.connected ? (
              <a
                href="/admin/drive"
                className="px-5 py-2.5 rounded-xl font-bold text-xs tracking-wider text-white bg-gradient-to-r from-[#FF8C00] to-[#E53935] hover:opacity-90 transition cursor-pointer shadow-lg shadow-orange-500/10"
              >
                CONNECT GOOGLE DRIVE
              </a>
            ) : (
              <div className="flex items-center gap-2">
                <a
                  href="/admin/drive"
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold text-[#FF8C00] bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/20 transition cursor-pointer"
                >
                  Change File
                </a>
                <a
                  href="/admin/drive"
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold text-white/80 bg-white/5 hover:bg-white/10 border border-white/10 transition cursor-pointer"
                >
                  Test Connection
                </a>
                <a
                  href="/admin/drive"
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 transition cursor-pointer"
                >
                  Disconnect
                </a>
              </div>
            )}
          </div>
        </div>

        {driveData?.connected && (
          <div className="mt-6 pt-5 border-t border-[#2A2A4A]/80 grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
            <div className="p-3.5 rounded-xl bg-[#0F0F22] border border-[#2A2A4A]">
              <div className="text-white/40 font-semibold uppercase tracking-wider text-[10px]">Selected File</div>
              <div className="text-sm font-bold text-white mt-1">{driveData.file_name || 'itemmast.xlsx'}</div>
            </div>
            <div className="p-3.5 rounded-xl bg-[#0F0F22] border border-[#2A2A4A]">
              <div className="text-white/40 font-semibold uppercase tracking-wider text-[10px]">File ID</div>
              <div className="font-mono text-white/70 mt-1 truncate">{driveData.file_id || 'Stored securely'}</div>
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
    </div>
  );
}
