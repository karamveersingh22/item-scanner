'use strict';
'use client';

import React, { useEffect, useState } from 'react';

interface DriveStatus {
  connected: boolean;
  folder_id: string | null;
  file_id: string | null;
  file_name: string | null;
}

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime?: string;
  size?: string;
}

export default function GoogleDrivePage() {
  const [status, setStatus] = useState<DriveStatus | null>(null);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  const [isLoading, setIsLoading] = useState(true);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [isSavingFile, setIsSavingFile] = useState(false);
  const [isDisconnecting, setIsDisconnecting] = useState(false);
  const [showFileBrowser, setShowFileBrowser] = useState(false);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);

  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<{ connected: boolean; message: string } | null>(null);

  useEffect(() => {
    loadStatus();
  }, []);

  async function loadStatus() {
    setIsLoading(true);
    try {
      const res = await fetch('/api/google-drive/status');
      if (res.ok) {
        const json = await res.json();
        if (json.success) {
          setStatus(json.data);
          setSelectedFileId(json.data.file_id);
          setSelectedFileName(json.data.file_name);
        }
      }
    } catch {
      setErrorMessage('Could not load Google Drive status');
    } finally {
      setIsLoading(false);
    }
  }

  const handleConnect = async () => {
    setIsConnecting(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/google-drive/auth-url');
      const json = await res.json();
      if (res.ok && json.success && json.data?.auth_url) {
        window.location.href = json.data.auth_url;
      } else {
        setErrorMessage(json.error || 'Failed to initiate Google authorization');
        setIsConnecting(false);
      }
    } catch {
      setErrorMessage('Unable to reach server. Please try again.');
      setIsConnecting(false);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setTestResult(null);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/google-drive/test');
      const json = await res.json();
      if (res.ok && json.success) {
        setTestResult(json.data);
      } else {
        setErrorMessage(json.error || 'Connection test failed');
      }
    } catch {
      setErrorMessage('Network error during connection test');
    } finally {
      setIsTesting(false);
    }
  };

  const handleLoadFiles = async () => {
    setShowFileBrowser(true);
    setIsLoadingFiles(true);
    setErrorMessage(null);
    try {
      const res = await fetch('/api/google-drive/files');
      const json = await res.json();
      if (res.ok && json.success && Array.isArray(json.data?.files)) {
        setFiles(json.data.files);
      } else {
        setErrorMessage(json.error || 'Failed to list Google Drive files');
      }
    } catch {
      setErrorMessage('Unable to fetch spreadsheets from Google Drive');
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const handleSaveFileSelection = async () => {
    if (!selectedFileId || !selectedFileName) {
      setErrorMessage('Please select an Excel file from the list');
      return;
    }

    setIsSavingFile(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch('/api/google-drive/select', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          file_id: selectedFileId,
          file_name: selectedFileName,
        }),
      });

      const json = await res.json();
      if (res.ok && json.success) {
        setSuccessMessage(`'${selectedFileName}' saved as your Item Master source file.`);
        setShowFileBrowser(false);
        await loadStatus();
      } else {
        setErrorMessage(json.error || 'Failed to save file selection');
      }
    } catch {
      setErrorMessage('Unable to save file selection');
    } finally {
      setIsSavingFile(false);
    }
  };

  const handleDisconnect = async () => {
    const confirm = window.confirm(
      'Are you sure you want to disconnect Google Drive?\n\nThis will remove stored authorizations. Files in your Google Drive will NOT be deleted.'
    );
    if (!confirm) return;

    setIsDisconnecting(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch('/api/google-drive/disconnect', { method: 'POST' });
      const json = await res.json();
      if (res.ok && json.success) {
        setSuccessMessage('Google Drive has been safely disconnected.');
        setStatus({
          connected: false,
          folder_id: null,
          file_id: null,
          file_name: null,
        });
        setSelectedFileId(null);
        setSelectedFileName(null);
        setShowFileBrowser(false);
      } else {
        setErrorMessage(json.error || 'Failed to disconnect');
      }
    } catch {
      setErrorMessage('Unable to disconnect Google Drive');
    } finally {
      setIsDisconnecting(false);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-[#14142B] rounded-2xl border border-[#2A2A4A] p-8 text-center text-white/50">
        Loading Google Drive status...
      </div>
    );
  }

  const isConnected = status?.connected === true;

  return (
    <div className="space-y-6">
      <div className="border-b border-[#2A2A4A] pb-4">
        <h1 className="text-2xl font-bold text-white">Google Drive Integration</h1>
        <p className="text-sm text-white/50 mt-1">
          Authorize your organization's Google Drive and choose the <span className="font-mono text-white/70">itemmast.xlsx</span> file.
        </p>
      </div>

      {successMessage && (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/30 p-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-emerald-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <p className="text-sm font-medium text-emerald-200">{successMessage}</p>
        </div>
      )}

      {errorMessage && (
        <div className="rounded-xl bg-red-500/10 border border-red-500/30 p-4 flex items-center gap-3">
          <svg className="w-5 h-5 text-red-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <p className="text-sm font-medium text-red-200">{errorMessage}</p>
        </div>
      )}

      {/* Connection Card */}
      <div className="bg-[#14142B] rounded-2xl border border-[#2A2A4A] p-6 sm:p-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${
              isConnected ? 'bg-emerald-500/15 text-emerald-400' : 'bg-white/5 text-white/40'
            }`}>
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 15a4 4 0 004 4h9a5 5 0 10-.1-9.999 5.002 5.002 0 00-9.78 2.096A4.001 4.001 0 003 15z" />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-2.5">
                <h2 className="text-lg font-bold text-white">Google Drive Status</h2>
                <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full border ${
                  isConnected
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30'
                    : 'bg-white/5 text-white/50 border-white/10'
                }`}>
                  {isConnected ? '● Connected' : '○ Not Connected'}
                </span>
              </div>
              <p className="text-xs text-white/50 mt-1">
                {isConnected
                  ? 'Private Google Drive access authorized via OAuth 2.0. Tokens encrypted at rest with AES-256.'
                  : 'Connect your company Google Drive to select your inventory spreadsheet source.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {!isConnected ? (
              <button
                onClick={handleConnect}
                disabled={isConnecting}
                className="px-5 py-2.5 rounded-xl font-bold text-xs tracking-wider text-white bg-gradient-to-r from-[#FF8C00] to-[#E53935] hover:opacity-90 transition disabled:opacity-50 cursor-pointer shadow-lg shadow-orange-500/10"
              >
                {isConnecting ? 'CONNECTING...' : 'CONNECT GOOGLE DRIVE'}
              </button>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={handleTestConnection}
                  disabled={isTesting}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold text-white/80 bg-white/5 hover:bg-white/10 border border-white/10 transition cursor-pointer"
                >
                  {isTesting ? 'TESTING...' : 'Test Connection'}
                </button>
                <button
                  onClick={handleDisconnect}
                  disabled={isDisconnecting}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold text-red-400 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 transition cursor-pointer"
                >
                  {isDisconnecting ? 'DISCONNECTING...' : 'Disconnect'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Live Test Result Banner */}
        {testResult && (
          <div className={`mt-5 rounded-xl p-3.5 border flex items-center gap-2.5 text-xs ${
            testResult.connected
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-red-500/10 border-red-500/30 text-red-300'
          }`}>
            <span className={`w-2 h-2 rounded-full ${testResult.connected ? 'bg-emerald-400' : 'bg-red-400'}`} />
            <span>{testResult.message}</span>
          </div>
        )}

        {/* Connected File Information */}
        {isConnected && (
          <div className="mt-8 pt-6 border-t border-[#2A2A4A]/80">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-bold uppercase tracking-wider text-white/70">
                  Selected Item Master File
                </h3>
                <p className="text-xs text-white/40 mt-0.5">
                  This spreadsheet will be synchronized to populate the mobile barcode lookup catalog.
                </p>
              </div>
              <button
                onClick={handleLoadFiles}
                className="px-4 py-2 rounded-xl text-xs font-bold text-[#FF8C00] bg-orange-500/10 hover:bg-orange-500/20 border border-orange-500/20 transition cursor-pointer"
              >
                {status?.file_id ? 'Change File' : 'Select itemmast.xlsx'}
              </button>
            </div>

            <div className="mt-4 p-4 rounded-xl bg-[#0F0F22] border border-[#2A2A4A] flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
                  <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div>
                  <div className="text-sm font-bold text-white">
                    {status?.file_name || 'No file selected yet'}
                  </div>
                  <div className="text-[11px] font-mono text-white/40">
                    File ID: {status?.file_id || 'Not assigned'}
                  </div>
                </div>
              </div>

              {status?.file_id && (
                <span className="text-xs font-semibold text-emerald-400 flex items-center gap-1.5">
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span>Ready for Sync</span>
                </span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Drive File Browser Modal / Section */}
      {showFileBrowser && (
        <div className="bg-[#14142B] rounded-2xl border border-[#FF8C00]/40 p-6 sm:p-8 space-y-5 shadow-2xl">
          <div className="flex items-center justify-between border-b border-[#2A2A4A] pb-4">
            <div>
              <h2 className="text-lg font-bold text-white">Select Inventory Spreadsheet</h2>
              <p className="text-xs text-white/50 mt-0.5">
                Choose the <span className="font-mono text-white/80">itemmast.xlsx</span> file from your connected Google Drive.
              </p>
            </div>
            <button
              onClick={() => setShowFileBrowser(false)}
              className="text-white/40 hover:text-white text-sm"
            >
              ✕ Close
            </button>
          </div>

          {isLoadingFiles ? (
            <div className="py-12 text-center text-white/50 flex flex-col items-center gap-3">
              <div className="w-5 h-5 border-2 border-[#FF8C00] border-t-transparent rounded-full animate-spin" />
              <span className="text-xs">Scanning Google Drive for .xlsx files...</span>
            </div>
          ) : files.length === 0 ? (
            <div className="py-8 text-center text-white/40 text-xs">
              No .xlsx spreadsheet files were found in your Google Drive root. Please verify that your inventory spreadsheet has been uploaded.
            </div>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
              {files.map((file) => {
                const isSelected = selectedFileId === file.id;
                const isItemMast = file.name.toLowerCase().includes('itemmast');

                return (
                  <div
                    key={file.id}
                    onClick={() => {
                      setSelectedFileId(file.id);
                      setSelectedFileName(file.name);
                    }}
                    className={`p-3.5 rounded-xl border cursor-pointer flex items-center justify-between transition ${
                      isSelected
                        ? 'bg-[#FF8C00]/15 border-[#FF8C00] text-white shadow-sm'
                        : 'bg-[#0F0F22] border-[#2A2A4A] hover:border-white/20 text-white/80'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`p-2 rounded-lg ${isSelected ? 'bg-[#FF8C00]/20 text-[#FF8C00]' : 'bg-white/5 text-white/40'}`}>
                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                        </svg>
                      </div>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate flex items-center gap-2">
                          <span>{file.name}</span>
                          {isItemMast && (
                            <span className="text-[10px] font-bold px-2 py-0.2 rounded bg-orange-500/20 text-[#FF8C00] border border-orange-500/30">
                              RECOMMENDED
                            </span>
                          )}
                        </div>
                        <div className="text-[11px] font-mono text-white/40 truncate">
                          ID: {file.id}
                        </div>
                      </div>
                    </div>

                    <div className="shrink-0 text-right">
                      {isSelected ? (
                        <span className="inline-flex items-center gap-1 text-xs font-bold text-[#FF8C00]">
                          <span>Selected</span>
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                          </svg>
                        </span>
                      ) : (
                        <span className="text-xs text-white/30">Click to select</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="pt-2 flex justify-end gap-3">
            <button
              onClick={() => setShowFileBrowser(false)}
              className="px-4 py-2.5 rounded-xl text-xs font-semibold text-white/60 hover:text-white border border-white/10"
            >
              Cancel
            </button>
            <button
              onClick={handleSaveFileSelection}
              disabled={isSavingFile || !selectedFileId}
              className="px-5 py-2.5 rounded-xl font-bold text-xs tracking-wider text-white bg-gradient-to-r from-[#FF8C00] to-[#E53935] hover:opacity-90 disabled:opacity-50 cursor-pointer shadow-lg shadow-orange-500/10"
            >
              {isSavingFile ? 'SAVING SELECTION...' : 'CONFIRM & SAVE SELECTION'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
