'use strict';
'use client';

import React, { useEffect, useState } from 'react';

interface CompanyProfile {
  id: string;
  company_name: string;
  username: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export default function CompanyProfilePage() {
  const [profile, setProfile] = useState<CompanyProfile | null>(null);
  const [companyName, setCompanyName] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    async function loadProfile() {
      try {
        const res = await fetch('/api/company/profile');
        if (res.ok) {
          const json = await res.json();
          if (json.success && json.data?.company) {
            setProfile(json.data.company);
            setCompanyName(json.data.company.company_name);
          }
        }
      } catch (e) {
        console.error('Failed to load company profile:', e);
      } finally {
        setIsLoading(false);
      }
    }

    loadProfile();
  }, []);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!companyName.trim()) {
      setErrorMessage('Company name cannot be empty');
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    try {
      const res = await fetch('/api/company/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ company_name: companyName.trim() }),
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setProfile(data.data.company);
        setSuccessMessage('Company profile updated successfully.');
      } else {
        setErrorMessage(data.error || 'Failed to update company profile');
      }
    } catch {
      setErrorMessage('Unable to connect to server. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return (
      <div className="bg-[#14142B] rounded-2xl border border-[#2A2A4A] p-8 text-center text-white/50">
        Loading company profile...
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="border-b border-[#2A2A4A] pb-4">
        <h1 className="text-2xl font-bold text-white">Company Profile</h1>
        <p className="text-sm text-white/50 mt-1">
          Manage your organization name and inspect read-only account identifiers.
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

      <div className="bg-[#14142B] rounded-2xl border border-[#2A2A4A] p-6 sm:p-8">
        <form onSubmit={handleSave} className="space-y-6 max-w-xl">
          {/* Editable Field: Company Name */}
          <div>
            <label htmlFor="companyName" className="block text-xs font-bold uppercase tracking-wider text-white/70">
              Company Name <span className="text-[#FF8C00]">*</span>
            </label>
            <p className="text-xs text-white/40 mt-0.5">
              The display name presented across the web dashboard and Flutter mobile applications.
            </p>
            <input
              id="companyName"
              type="text"
              required
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              className="mt-2 w-full rounded-xl bg-[#0F0F22] border border-[#2A2A4A] px-4 py-3 text-white placeholder-white/20 focus:outline-none focus:border-[#FF8C00] focus:ring-1 focus:ring-[#FF8C00] transition"
            />
          </div>

          <div className="pt-2">
            <button
              type="submit"
              disabled={isSaving}
              className="px-6 py-3 rounded-xl font-bold text-sm tracking-wider text-white bg-gradient-to-r from-[#FF8C00] to-[#E53935] hover:opacity-90 transition disabled:opacity-50 cursor-pointer shadow-lg shadow-orange-500/10"
            >
              {isSaving ? 'SAVING...' : 'SAVE CHANGES'}
            </button>
          </div>
        </form>

        <div className="mt-10 pt-8 border-t border-[#2A2A4A]/80">
          <h2 className="text-sm font-bold uppercase tracking-wider text-white/60 mb-4">
            Read-Only System Identifiers
          </h2>

          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Company ID */}
            <div className="p-4 rounded-xl bg-[#0F0F22] border border-[#2A2A4A]/60">
              <dt className="text-xs font-semibold text-white/50">Company Internal ID</dt>
              <dd className="mt-1 font-mono text-xs text-white/90 break-all select-all">
                {profile?.id}
              </dd>
              <p className="text-[11px] text-white/30 mt-1">Immutable UUID generated on provision.</p>
            </div>

            {/* Account Status */}
            <div className="p-4 rounded-xl bg-[#0F0F22] border border-[#2A2A4A]/60">
              <dt className="text-xs font-semibold text-white/50">Account Status</dt>
              <dd className="mt-1 text-sm font-bold text-emerald-400 flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                <span>{profile?.status}</span>
              </dd>
              <p className="text-[11px] text-white/30 mt-1">System managed account lifecycle.</p>
            </div>

            {/* Created At */}
            <div className="p-4 rounded-xl bg-[#0F0F22] border border-[#2A2A4A]/60">
              <dt className="text-xs font-semibold text-white/50">Registration Date</dt>
              <dd className="mt-1 text-xs text-white/80">
                {profile?.created_at ? new Date(profile.created_at).toLocaleString() : '—'}
              </dd>
            </div>

            {/* Updated At */}
            <div className="p-4 rounded-xl bg-[#0F0F22] border border-[#2A2A4A]/60">
              <dt className="text-xs font-semibold text-white/50">Last Profile Update</dt>
              <dd className="mt-1 text-xs text-white/80">
                {profile?.updated_at ? new Date(profile.updated_at).toLocaleString() : '—'}
              </dd>
            </div>
          </dl>
        </div>
      </div>
    </div>
  );
}
